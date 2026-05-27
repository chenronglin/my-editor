# 小说编辑器审阅流程与 API 设计

## 1. 当前编辑器能力评估

当前项目已经具备一部分基础能力：

- 已有划词批注：选中文本后可以创建批注，正文中通过 `MarkNode` 标记批注范围。
- 已有批注区与回复：批注线程支持多条回复。
- 已有修订模式：工具栏有“修订模式”开关，开启后输入会生成 `SuggestionNode`，删除会保留为删除建议。
- 已有文档内联修订：新增/删除修订保存在正文结构里，不再依赖独立“修订记录”侧栏作为数据源。
- 已有 mock 角色与权限：前端可切换编辑、作者身份，编辑开启修订后作者正文只读。
- 已有显示模式：审阅模式显示修订痕迹，最终模式隐藏删除内容并把新增内容按正文显示。
- 已有块级粘贴处理：剪贴板纯文本按换行拆成多个正文块，修订模式下每行会成为独立的新增修订块。

当前功能还不能完整满足业务流程，主要缺口如下：

- 没有用户角色与权限控制。现在编辑、作者的能力没有从业务身份上区分。
- 修订模式只是前端本地状态，没有保存到后端，也没有同步成一个“编辑正在修订”的业务锁。
- 作者无法被可靠地禁止编辑。当前没有“编辑开启修订模式时，作者正文只读、批注可回复”的锁机制。
- 批注和修订没有后台持久化接口。当前批注存储偏前端示例/Yjs 协同，不适合作为业务数据源。
- 修订记录没有完整业务状态。现有 `SuggestionNode` 记录了新增/删除、作者、时间和备注，但没有 pending/accepted/rejected、会话、审核状态等后台字段。
- 评论删除、修订接受/拒绝等操作没有业务权限约束。

结论：可以基于现在的 `CommentPlugin`、`TrackChangesPlugin`、`SuggestionNode` 继续扩展，但需要先补齐角色、锁、保存模型和后台接口。

## 2. “修订模式只做开关”是否可行

可以把“修订模式”设计成一个入口开关，不必单独做传统意义上的“修订记录表”。

但不能只保存一个布尔值。因为作者需要看到修改前后的内容，系统必须保存修订痕迹。推荐做法是：

- `reviewSession.enabled` 表示编辑是否正在修订，用于锁定作者正文编辑。
- 修订痕迹保存在文档正文 JSON 内的 `suggestion` 节点里。
- 审阅模式直接显示文档内联修订；最终模式从同一份正文结构计算显示结果。
- 后台可以按需从正文 JSON 中解析出修订摘要，不一定额外保存一份 revision log。

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
5. 编辑以块为单位操作正文：
   - 段落格式、标题格式只作用于当前光标所在块。
   - 从剪贴板粘贴多行文本时，每个换行会拆成独立块。
   - 修订模式下多行粘贴会生成多个独立新增修订块。
6. 编辑选中文本后点击批注按钮，填写意见并提交。
7. 编辑可在批注区继续回复。
8. 编辑点击“结束修订”，后台关闭 `reviewSession` 并释放正文锁。

### 3.2 作者流程

1. 作者打开章节编辑页。
2. 如果编辑正在修订：
   - 正文区域只读。
   - 页面顶部显示“编辑正在修订，正文暂不可编辑”。
   - 批注区仍可回复。
   - 作者可以实时或刷新后看到新增/删除修订。
3. 作者阅读批注区意见，并在对应批注线程下回复。
4. 作者打开正文时，可以同时看到原文删除痕迹和新增内容。
5. 作者可以切换显示模式：
   - 审阅模式：显示新增、删除修订痕迹。
   - 最终模式：隐藏删除内容，新增内容按正文展示，视图只读。
6. 编辑结束修订后，作者可恢复正文编辑。是否允许作者接受/拒绝修订，可作为后续权限开关：
   - 简化版：只允许查看和回复，由编辑或后台流程统一处理修订。
   - 完整版：允许作者接受/拒绝修订，接受后正文落地，拒绝后恢复原文。

### 3.3 锁与权限规则

- 只有编辑可以开启/关闭修订模式。
- 修订模式开启后，锁定的是“正文编辑”，不锁定“批注回复”。
- 作者在锁定期间调用正文保存接口，应返回 `423 LOCKED`。
- 最终模式是显示模式，不修改正文 JSON；切回审阅模式后仍可看到原始修订痕迹。
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
- 多行粘贴时，不应在单个 `suggestion` 节点中插入换行符模拟段落；应拆成多个块，每个块内部包含自己的 `suggestion` 节点。

### 4.3 块级正文约定

正文必须以块为基本编辑单位。Lexical `root.children` 下的直接子节点视为块，常见类型包括：

- `paragraph`：正文段落。
- `heading`：标题块，使用 `tag` 区分 `h1`、`h2`、`h3`。
- 其他块级节点：后续可扩展列表、引用、图片等。

示例：

```json
{
  "root": {
    "type": "root",
    "children": [
      {
        "type": "heading",
        "tag": "h1",
        "children": [
          {
            "type": "text",
            "text": "第一章 雨夜"
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "她站在雨里很久。"
          }
        ]
      }
    ]
  }
}
```

块级规则：

- 工具栏的“正文、一级标题、二级标题、三级标题”只转换当前光标所在块，不批量转换整篇正文。
- 剪贴板文本中的换行符是块边界。粘贴 `第一行\n第二行` 应生成两个 `paragraph` 块。
- 修订模式下粘贴多行文本时，每一行生成一个独立 `paragraph`，段落内部用 `suggestionType = insertion` 表示新增。
- 最终模式不修改块结构，只按显示规则隐藏或简化修订节点。

### 4.4 显示模式

显示模式是前端视图状态，不应直接改变正文 JSON。

```json
{
  "displayMode": "review",
  "availableDisplayModes": ["review", "final"]
}
```

取值说明：

- `review`：审阅模式，显示新增、删除修订痕迹。
- `final`：最终模式，隐藏删除修订内容，将新增修订内容按普通正文显示，正文只读。

最终模式计算规则：

- `suggestionType = insertion`：显示子节点内容，但不显示新增样式。
- `suggestionType = deletion`：隐藏子节点内容。
- 普通文本节点：正常显示。

### 4.5 批注线程

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
  "display": {
    "mode": "review",
    "availableModes": ["review", "final"]
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

`display.mode` 只控制当前打开编辑器时的默认显示模式。用户在前端切换最终模式时，可以先本地计算；如果需要跨设备记住用户偏好，可另存为用户级视图设置。

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

保存正文前端必须保证块级结构合法：

- 粘贴多行文本后应提交多个 paragraph 块，而不是单个 paragraph 里塞多个换行。
- 修订模式下，多行粘贴应保存为多个 paragraph，每个 paragraph 内部包含自己的 insertion suggestion。
- 后台校验时可以拒绝含有异常大量内联换行的正文块，或在保存前进行规范化。

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
- 修订痕迹以内联 `SuggestionNode` 保存；前端不再需要独立“修订记录”区作为业务界面。
- 审阅模式直接显示 `SuggestionNode` 的新增、删除样式；最终模式通过同一份文档结构计算，只隐藏删除内容并去掉新增样式。
- 段落、标题等块格式操作必须锁定当前块，不应该对整篇正文执行批量转换。
- 粘贴多行文本时，前端必须先按换行拆成块，再插入编辑器；修订模式下每个块包裹独立 insertion suggestion。
- 如果接入多人实时协同，可在 REST 保存之外增加 WebSocket/Yjs 通道，但后台仍应以章节快照、评论线程、修订会话为最终业务数据。

## 7. 最小落地顺序

1. 增加角色与权限数据，区分编辑和作者。
2. 增加修订会话接口，把“修订模式”从本地开关升级为后台锁。
3. 保存 Lexical 正文 JSON，确保 `SuggestionNode` 被持久化。
4. 保证正文按块保存，粘贴换行会生成多个块。
5. 增加审阅、最终两种显示模式；最终模式本地计算且只读。
6. 保存批注线程和回复。
7. 作者页按权限只读正文，但保留批注回复能力。
8. 后续再决定是否开放作者接受/拒绝修订。
