# 小说编辑器审阅流程与 API 设计

## 1. 当前编辑器能力评估

当前项目已经具备一部分基础能力：

- 已有划词批注：选中文本后可以创建批注，正文中通过 `MarkNode` 标记批注范围。
- 已有批注区与回复：批注线程支持多条回复。
- 已有修订模式：工具栏有“修订模式”开关，开启后输入会生成 `SuggestionNode`，删除会保留为删除建议。
- 已有修订侧栏：可以展示新增/删除建议，并支持接受、拒绝和备注。

当前功能还不能完整满足业务流程，主要缺口如下：

- 没有用户角色与权限控制。现在编辑、作者的能力没有从业务身份上区分。
- 修订模式只是前端本地状态，没有保存到后端，也没有同步成一个“编辑正在修订”的业务锁。
- 作者无法被可靠地禁止编辑。当前没有“编辑开启修订模式时，作者正文只读、批注可回复”的锁机制。
- 批注和修订没有后台持久化接口。当前批注存储偏前端示例/Yjs 协同，不适合作为业务数据源。
- 修订记录没有业务状态。现有 `SuggestionNode` 记录了新增/删除、作者、时间和备注，但没有 pending/accepted/rejected、会话、审核状态等后台字段。
- 评论删除、修订接受/拒绝等操作没有业务权限约束。

结论：可以基于现在的 `CommentPlugin`、`TrackChangesPlugin`、`SuggestionNode` 继续扩展，但需要先补齐角色、锁、保存模型和后台接口。

## 2. “修订模式只做开关”是否可行

可以把“修订模式”设计成一个入口开关，不必单独做传统意义上的“修订记录表”。

但不能只保存一个布尔值。因为作者需要看到修改前后的内容，系统必须保存修订痕迹。推荐做法是：

- `reviewSession.enabled` 表示编辑是否正在修订，用于锁定作者正文编辑。
- 修订痕迹保存在文档正文 JSON 内的 `suggestion` 节点里。
- 后台可以按需从正文 JSON 中解析出修订列表，不一定额外保存一份 revision log。

也就是说：“开关 + 文档内联修订痕迹”可以满足需求；“只有开关 + 直接改正文”不能满足作者查看修改前后的需求。

## 3. 推荐界面操作流程

### 3.1 编辑流程

1. 编辑打开章节编辑页。
2. 点击工具栏“开启修订模式”。
3. 前端调用“开启修订会话”接口，后台创建 `reviewSession` 并锁定正文编辑权。
4. 编辑开始修改正文：
   - 新增文字显示为新增修订。
   - 删除文字显示为删除修订，原文仍可见。
   - 替换文字表现为“删除旧内容 + 新增新内容”。
5. 编辑选中文本后点击批注按钮，填写意见并提交。
6. 编辑可在批注区继续回复，也可在修订侧栏给某条修订添加备注。
7. 编辑点击“结束修订”，后台关闭 `reviewSession` 并释放正文锁。

### 3.2 作者流程

1. 作者打开章节编辑页。
2. 如果编辑正在修订：
   - 正文区域只读。
   - 页面顶部显示“编辑正在修订，正文暂不可编辑”。
   - 批注区仍可回复。
   - 作者可以实时或刷新后看到新增/删除修订。
3. 作者阅读批注区意见，并在对应批注线程下回复。
4. 作者打开正文时，可以同时看到原文删除痕迹和新增内容。
5. 编辑结束修订后，作者可恢复正文编辑。是否允许作者接受/拒绝修订，可作为后续权限开关：
   - 简化版：只允许查看和回复，由编辑或后台流程统一处理修订。
   - 完整版：允许作者接受/拒绝修订，接受后正文落地，拒绝后恢复原文。

### 3.3 锁与权限规则

- 只有编辑可以开启/关闭修订模式。
- 修订模式开启后，锁定的是“正文编辑”，不锁定“批注回复”。
- 作者在锁定期间调用正文保存接口，应返回 `423 LOCKED`。
- 编辑修订会话需要心跳续约；超时后后台可自动释放锁。
- 保存正文时必须带 `version` 或 `If-Match`，避免覆盖他人修改。

## 4. 数据模型 JSON

### 4.1 章节编辑文档

```json
{
  "id": "chapter_1001",
  "novelId": "novel_88",
  "title": "第一章 雨夜",
  "status": "IN_REVIEW",
  "bodyFormat": "lexical",
  "body": {
    "root": {
      "type": "root",
      "children": []
    }
  },
  "version": 17,
  "authorId": "user_author_1",
  "editorId": "user_editor_1",
  "reviewSession": {
    "id": "review_3001",
    "enabled": true,
    "status": "ACTIVE",
    "ownerUserId": "user_editor_1",
    "ownerRole": "editor",
    "lockScope": "content",
    "baseVersion": 16,
    "startedAt": "2026-05-27T10:00:00.000Z",
    "lastHeartbeatAt": "2026-05-27T10:04:00.000Z",
    "expiresAt": "2026-05-27T10:06:00.000Z"
  },
  "commentThreadCount": 3,
  "pendingSuggestionCount": 5,
  "createdAt": "2026-05-20T02:00:00.000Z",
  "updatedAt": "2026-05-27T10:04:30.000Z"
}
```

### 4.2 文档内联修订节点

修订痕迹推荐保存在 Lexical 正文 JSON 里。现有项目的 `SuggestionNode` 已经接近这个结构。

```json
{
  "type": "suggestion",
  "suggestionId": "sug_9f8a",
  "suggestionType": "deletion",
  "author": "编辑A",
  "authorId": "user_editor_1",
  "createdAt": 1779876000000,
  "comment": "这里建议删掉重复描写",
  "status": "pending",
  "children": [
    {
      "type": "text",
      "text": "被删除但仍可见的原文",
      "format": 0,
      "style": ""
    }
  ]
}
```

字段说明：

- `suggestionType`: `insertion` 或 `deletion`。替换可用一组 deletion + insertion 表示。
- `status`: `pending`、`accepted`、`rejected`。如果不做接受/拒绝流程，至少保留 `pending`。
- `authorId`: 建议新增，不能只依赖展示名 `author`。
- `comment`: 修订备注，不等同于正文批注线程。

### 4.3 批注线程

```json
{
  "id": "thread_2001",
  "chapterId": "chapter_1001",
  "status": "open",
  "quote": "她站在雨里很久",
  "anchor": {
    "markId": "mark_ab12",
    "type": "lexical-mark",
    "snapshotVersion": 17,
    "textQuote": "她站在雨里很久",
    "startOffset": 128,
    "endOffset": 136
  },
  "createdBy": {
    "userId": "user_editor_1",
    "role": "editor",
    "name": "编辑A"
  },
  "messages": [
    {
      "id": "comment_1",
      "body": "这里的情绪可以再具体一点。",
      "author": {
        "userId": "user_editor_1",
        "role": "editor",
        "name": "编辑A"
      },
      "deleted": false,
      "createdAt": "2026-05-27T10:01:00.000Z",
      "updatedAt": "2026-05-27T10:01:00.000Z"
    },
    {
      "id": "comment_2",
      "body": "我会补一段动作描写。",
      "author": {
        "userId": "user_author_1",
        "role": "author",
        "name": "作者B"
      },
      "deleted": false,
      "createdAt": "2026-05-27T10:03:00.000Z",
      "updatedAt": "2026-05-27T10:03:00.000Z"
    }
  ],
  "createdAt": "2026-05-27T10:01:00.000Z",
  "updatedAt": "2026-05-27T10:03:00.000Z"
}
```

## 5. API 设计

约定：

- Base URL: `/api`
- 所有接口使用 JSON。
- 用户身份从登录态或 Bearer Token 中解析，不由前端传 `role` 作为可信来源。
- 修改类接口建议使用 `If-Match: <version>` 或请求体 `version` 做并发控制。

### 5.1 获取章节编辑数据

`GET /api/chapters/{chapterId}/editor`

查询参数：

- `include=comments,suggestions,reviewSession`

响应：

```json
{
  "chapter": {
    "id": "chapter_1001",
    "novelId": "novel_88",
    "title": "第一章 雨夜",
    "status": "IN_REVIEW",
    "bodyFormat": "lexical",
    "body": {
      "root": {
        "type": "root",
        "children": []
      }
    },
    "version": 17,
    "updatedAt": "2026-05-27T10:04:30.000Z"
  },
  "reviewSession": {
    "id": "review_3001",
    "enabled": true,
    "status": "ACTIVE",
    "ownerUserId": "user_editor_1",
    "lockScope": "content",
    "expiresAt": "2026-05-27T10:06:00.000Z"
  },
  "permissions": {
    "canEditContent": false,
    "canStartReview": false,
    "canStopReview": false,
    "canCreateComment": false,
    "canReplyComment": true,
    "canAcceptSuggestion": false,
    "canRejectSuggestion": false
  },
  "commentThreads": [],
  "suggestions": []
}
```

前端使用 `permissions.canEditContent` 控制 Lexical `editor.setEditable()`。

### 5.2 保存正文

`PUT /api/chapters/{chapterId}/content`

请求：

```json
{
  "version": 17,
  "bodyFormat": "lexical",
  "body": {
    "root": {
      "type": "root",
      "children": []
    }
  },
  "clientMutationId": "cm_001"
}
```

响应：

```json
{
  "chapterId": "chapter_1001",
  "version": 18,
  "pendingSuggestionCount": 6,
  "savedAt": "2026-05-27T10:05:00.000Z"
}
```

错误：

- `409 VERSION_CONFLICT`: 客户端版本过旧。
- `423 CONTENT_LOCKED`: 作者在编辑修订期间尝试保存正文。
- `403 FORBIDDEN`: 当前用户无正文编辑权限。

### 5.3 开启修订模式

`POST /api/chapters/{chapterId}/review-sessions`

仅编辑可调用。

请求：

```json
{
  "version": 17,
  "mode": "track_changes",
  "lockScope": "content"
}
```

响应：

```json
{
  "reviewSession": {
    "id": "review_3001",
    "chapterId": "chapter_1001",
    "enabled": true,
    "status": "ACTIVE",
    "ownerUserId": "user_editor_1",
    "ownerRole": "editor",
    "lockScope": "content",
    "baseVersion": 17,
    "startedAt": "2026-05-27T10:00:00.000Z",
    "expiresAt": "2026-05-27T10:06:00.000Z"
  },
  "permissions": {
    "canEditContent": true,
    "canReplyComment": true
  }
}
```

错误：

- `409 REVIEW_ALREADY_ACTIVE`: 已有编辑修订会话。
- `403 FORBIDDEN`: 非编辑用户。

### 5.4 修订会话心跳

`POST /api/chapters/{chapterId}/review-sessions/{sessionId}/heartbeat`

响应：

```json
{
  "reviewSession": {
    "id": "review_3001",
    "status": "ACTIVE",
    "lastHeartbeatAt": "2026-05-27T10:04:00.000Z",
    "expiresAt": "2026-05-27T10:06:00.000Z"
  }
}
```

### 5.5 关闭修订模式

`PATCH /api/chapters/{chapterId}/review-sessions/{sessionId}`

请求：

```json
{
  "status": "CLOSED",
  "version": 18
}
```

响应：

```json
{
  "reviewSession": {
    "id": "review_3001",
    "enabled": false,
    "status": "CLOSED",
    "endedAt": "2026-05-27T10:20:00.000Z"
  },
  "chapter": {
    "id": "chapter_1001",
    "status": "REVISION_READY",
    "version": 18
  }
}
```

### 5.6 创建划词批注

`POST /api/chapters/{chapterId}/comment-threads`

请求：

```json
{
  "version": 18,
  "quote": "她站在雨里很久",
  "anchor": {
    "markId": "mark_ab12",
    "type": "lexical-mark",
    "snapshotVersion": 18,
    "textQuote": "她站在雨里很久",
    "startOffset": 128,
    "endOffset": 136
  },
  "body": "这里的情绪可以再具体一点。"
}
```

响应：

```json
{
  "thread": {
    "id": "thread_2001",
    "chapterId": "chapter_1001",
    "status": "open",
    "quote": "她站在雨里很久",
    "anchor": {
      "markId": "mark_ab12",
      "type": "lexical-mark"
    },
    "messages": [
      {
        "id": "comment_1",
        "body": "这里的情绪可以再具体一点。",
        "author": {
          "userId": "user_editor_1",
          "role": "editor",
          "name": "编辑A"
        },
        "deleted": false,
        "createdAt": "2026-05-27T10:01:00.000Z"
      }
    ]
  },
  "chapterVersion": 19
}
```

说明：创建划词批注时，正文也需要保存对应 `MarkNode`，因此建议与正文版本一起提交。

### 5.7 回复批注

`POST /api/comment-threads/{threadId}/comments`

请求：

```json
{
  "body": "我会补一段动作描写。"
}
```

响应：

```json
{
  "comment": {
    "id": "comment_2",
    "body": "我会补一段动作描写。",
    "author": {
      "userId": "user_author_1",
      "role": "author",
      "name": "作者B"
    },
    "deleted": false,
    "createdAt": "2026-05-27T10:03:00.000Z"
  }
}
```

### 5.8 更新批注线程状态

`PATCH /api/comment-threads/{threadId}`

请求：

```json
{
  "status": "resolved"
}
```

响应：

```json
{
  "threadId": "thread_2001",
  "status": "resolved",
  "updatedAt": "2026-05-27T10:30:00.000Z"
}
```

### 5.9 删除批注或回复

`DELETE /api/comment-threads/{threadId}/comments/{commentId}`

响应：

```json
{
  "commentId": "comment_2",
  "deleted": true,
  "body": "[已删除的批注]"
}
```

建议做软删除，避免破坏审阅上下文。

### 5.10 获取修订建议列表

`GET /api/chapters/{chapterId}/suggestions?status=pending`

响应：

```json
{
  "suggestions": [
    {
      "id": "sug_9f8a",
      "type": "deletion",
      "status": "pending",
      "text": "被删除但仍可见的原文",
      "comment": "这里建议删掉重复描写",
      "author": {
        "userId": "user_editor_1",
        "role": "editor",
        "name": "编辑A"
      },
      "createdAt": "2026-05-27T10:02:00.000Z"
    }
  ]
}
```

说明：如果不额外保存修订表，这个接口可以从正文 JSON 的 `suggestion` 节点解析生成。

### 5.11 接受或拒绝修订建议

如果产品决定支持作者处理修订，则提供以下接口。

`POST /api/chapters/{chapterId}/suggestions/{suggestionId}/accept`

`POST /api/chapters/{chapterId}/suggestions/{suggestionId}/reject`

请求：

```json
{
  "version": 18
}
```

响应：

```json
{
  "suggestionId": "sug_9f8a",
  "status": "accepted",
  "chapterVersion": 19,
  "pendingSuggestionCount": 4
}
```

处理规则：

- 接受 insertion：移除 suggestion 包裹，保留新增文字。
- 拒绝 insertion：删除新增文字。
- 接受 deletion：删除被标记的原文。
- 拒绝 deletion：移除 suggestion 包裹，保留原文。

## 6. 推荐前端接入点

- 打开页面时调用 `GET /api/chapters/{chapterId}/editor`，用 `permissions.canEditContent` 设置 Lexical 是否可编辑。
- 点击“修订模式”时，不再只改本地 state，而是调用开启/关闭修订会话接口。
- 正文变化自动保存到 `PUT /api/chapters/{chapterId}/content`。
- 批注创建、回复、删除、解决都走后台接口，再更新本地 `CommentStore`。
- 修订侧栏列表可以继续从当前 Lexical state 收集；后台保存时保留 `SuggestionNode`。
- 如果接入多人实时协同，可在 REST 保存之外增加 WebSocket/Yjs 通道，但后台仍应以章节快照、评论线程、修订会话为最终业务数据。

## 7. 最小落地顺序

1. 增加角色与权限数据，区分编辑和作者。
2. 增加修订会话接口，把“修订模式”从本地开关升级为后台锁。
3. 保存 Lexical 正文 JSON，确保 `SuggestionNode` 被持久化。
4. 保存批注线程和回复。
5. 作者页按权限只读正文，但保留批注回复能力。
6. 后续再决定是否开放作者接受/拒绝修订。
