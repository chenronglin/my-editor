# 将小说编辑器接入后台管理系统 TODO

目标：把当前 Lexical 小说编辑器作为一个独立业务模块接入已有后台管理系统。目标系统技术栈为 React 19、Vite、TypeScript、shadcn/ui、React Router、多级路由、权限管理、i18n、MSW/Faker、Zustand、React Query。

## 0. 接入前约定

- [ ] 确认后台管理系统中模块名称，建议命名为 `NovelEditor`、`ChapterEditor` 或 `ReviewEditor`。
- [ ] 确认编辑器所在业务入口，建议路由为 `/novels/:novelId/chapters/:chapterId/editor`。
- [ ] 确认当前编辑器只接入“章节正文编辑 + 划词批注 + 修订模式 + 审阅/最终显示模式”，暂不接入 Excalidraw、Tweet、Figma、YouTube、投票等 playground 示例能力。
- [ ] 确认正文存储格式使用 Lexical JSON，后台字段建议为 `bodyFormat = "lexical"`、`body = SerializedEditorState`、`version = number`。
- [ ] 确认权限来源以后台登录态/Token 为准，前端只消费接口返回的 `permissions`，不要信任前端传入的 `role`。

## 1. 梳理当前编辑器可迁移文件

- [ ] 保留核心入口：
  - `src/App.tsx`
  - `src/Editor.tsx`
  - `src/buildHTMLConfig.tsx`
  - `src/themes/PlaygroundEditorTheme.ts`
  - `src/themes/PlaygroundEditorTheme.css`
  - `src/index.css` 中编辑器相关样式
- [ ] 保留核心上下文：
  - `src/context/SettingsContext.tsx`
  - `src/context/ToolbarContext.tsx`
  - `src/context/FlashMessageContext.tsx`
- [ ] 将 `src/context/MockWorkflowContext.tsx` 替换为业务上下文，不要直接接入后台项目。
- [ ] 保留核心节点：
  - `src/nodes/PlaygroundNodes.ts`
  - `src/nodes/SuggestionNode.ts`
  - 当前正文需要的文本、链接、列表、标题、批注、修订相关节点
- [ ] 保留核心插件：
  - `src/plugins/ToolbarPlugin`
  - `src/plugins/CommentPlugin`
  - `src/plugins/TrackChangesPlugin`
  - `src/plugins/PasteAsBlocksPlugin`
  - `src/plugins/FloatingLinkEditorPlugin`
  - `src/plugins/FloatingTextFormatToolbarPlugin`
- [ ] 保留必要 UI：
  - `src/ui/ContentEditable.tsx`
  - `src/ui/Button.tsx`
  - `src/ui/DropDown.tsx`
  - `src/ui/Dialog.tsx`
  - `src/ui/Modal.tsx`
  - `src/ui/TextInput.tsx`
  - 相关 CSS
- [ ] 移除或延后迁移 playground 示例能力：
  - `ExcalidrawPlugin`
  - `AutoEmbedPlugin`
  - `PollPlugin`
  - `MentionsPlugin`
  - `TreeViewPlugin`
  - `TableOfContentsPlugin`
  - `PagesExtension`
  - `TweetNode`
  - `FigmaNode`
  - `YouTubeNode`

## 2. 在后台项目中创建模块目录

- [ ] 在后台项目创建模块目录，推荐：

```text
src/modules/novel-editor/
  components/
  context/
  hooks/
  nodes/
  plugins/
  services/
  stores/
  styles/
  types/
  utils/
  index.ts
```

- [ ] 将当前编辑器核心文件复制到对应目录：
  - `Editor.tsx` -> `components/NovelEditor.tsx`
  - `App.tsx` 中 Lexical Composer 相关逻辑 -> `components/NovelEditorProvider.tsx`
  - `nodes/*` -> `nodes/`
  - `plugins/*` -> `plugins/`
  - `ui/*` 中必要组件 -> `components/ui/` 或改造成 shadcn/ui 组件
  - `themes/*`、CSS -> `styles/`
- [ ] 在 `src/modules/novel-editor/index.ts` 统一导出模块公共 API。

## 3. 抽出可复用组件 API

- [ ] 新增组件 `NovelEditorModule`，由后台业务页调用。
- [ ] 组件 props 建议设计为：

```ts
type NovelEditorModuleProps = {
  chapterId: string;
  novelId?: string;
  initialBody: SerializedEditorState | null;
  version: number;
  currentUser: {
    id: string;
    name: string;
    role: "admin" | "editor" | "author" | string;
  };
  permissions: {
    canEditContent: boolean;
    canStartReview: boolean;
    canStopReview: boolean;
    canCreateComment: boolean;
    canReplyComment: boolean;
    canAcceptSuggestion?: boolean;
    canRejectSuggestion?: boolean;
  };
  reviewSession: ReviewSession | null;
  displayMode: "review" | "final";
  onDisplayModeChange: (mode: "review" | "final") => void;
  onSaveContent: (body: SerializedEditorState, version: number) => Promise<void>;
  onStartReview: () => Promise<void>;
  onStopReview: () => Promise<void>;
};
```

- [ ] 移除 `MockWorkflowProvider` 中的假身份切换按钮，将用户、权限、审阅会话全部改为 props 或业务 store。
- [ ] 将 `WorkflowHeader` 拆到后台业务页，编辑器内部只保留必要状态栏和正文编辑区域。
- [ ] 保留 `editor.setEditable(permissions.canEditContent)`，不要用前端角色自行推导是否可编辑。
- [ ] 将“审阅/最终”显示模式作为前端 UI 状态，默认值来自接口返回的 `display.mode`。

## 4. 依赖安装与版本对齐

- [ ] 在后台项目安装 Lexical 相关依赖，版本尽量与当前项目一致：

```bash
pnpm add lexical @lexical/react @lexical/rich-text @lexical/list @lexical/link @lexical/mark @lexical/selection @lexical/table @lexical/utils @lexical/clipboard @lexical/code @lexical/code-prism @lexical/code-shiki @lexical/file @lexical/hashtag @lexical/overflow @lexical/plain-text
```

- [ ] 安装当前核心功能需要的运行时依赖：

```bash
pnpm add @floating-ui/react date-fns lodash-es react-error-boundary
```

- [ ] 如果暂不迁移 Excalidraw，先不要安装 `@excalidraw/excalidraw`、`yjs`、`y-websocket`。
- [ ] 确认后台项目 React 版本为 React 19，避免出现多份 React。
- [ ] 确认 TypeScript 配置支持 `jsx: "react-jsx"` 和 Vite ESM。

## 5. 路由接入

- [ ] 在后台系统路由配置中新增页面：

```tsx
{
  path: "/novels/:novelId/chapters/:chapterId/editor",
  element: (
    <PermissionGuard permission="chapter:edit">
      <ChapterEditorPage />
    </PermissionGuard>
  ),
}
```

- [ ] `ChapterEditorPage` 负责：
  - 从 URL 读取 `novelId`、`chapterId`
  - 调用 React Query 获取章节编辑数据
  - 处理加载态、错误态、无权限态
  - 渲染后台系统面包屑、页面标题、保存状态
  - 将数据传入 `NovelEditorModule`
- [ ] 如果后台系统有多级嵌套路由，将页面挂到“小说管理/章节管理”菜单下。
- [ ] 在菜单配置中新增入口，并绑定权限码，例如 `chapter:edit`、`chapter:review`。

## 6. React Query 数据接入

- [ ] 新增服务文件 `src/modules/novel-editor/services/chapterEditorApi.ts`。
- [ ] 实现获取编辑器数据：

```ts
GET /api/chapters/{chapterId}/editor?include=comments,suggestions,reviewSession
```

- [ ] 实现保存正文：

```ts
PUT /api/chapters/{chapterId}/content
```

- [ ] 实现开启修订：

```ts
POST /api/chapters/{chapterId}/review-sessions
```

- [ ] 实现修订会话心跳：

```ts
POST /api/chapters/{chapterId}/review-sessions/{sessionId}/heartbeat
```

- [ ] 实现关闭修订：

```ts
PATCH /api/chapters/{chapterId}/review-sessions/{sessionId}
```

- [ ] 实现批注线程接口：
  - `POST /api/chapters/{chapterId}/comment-threads`
  - `POST /api/comment-threads/{threadId}/messages`
  - `PATCH /api/comment-threads/{threadId}`
- [ ] 新增 hooks：
  - `useChapterEditorQuery(chapterId)`
  - `useSaveChapterContentMutation(chapterId)`
  - `useStartReviewSessionMutation(chapterId)`
  - `useStopReviewSessionMutation(chapterId)`
  - `useReviewSessionHeartbeat(chapterId, sessionId)`
  - `useCommentThreadMutations(chapterId)`
- [ ] 保存成功后更新 React Query 缓存中的 `version`。
- [ ] 遇到 `409 VERSION_CONFLICT` 时提示用户刷新或重新拉取最新正文。
- [ ] 遇到 `423 CONTENT_LOCKED` 时切换正文为只读，并刷新 `reviewSession`。

## 7. Zustand 状态接入

- [ ] 新增 `src/modules/novel-editor/stores/useNovelEditorStore.ts`。
- [ ] Zustand 只保存前端 UI 状态，不保存后台可信业务权限：
  - `displayMode`
  - `isSaving`
  - `lastSavedAt`
  - `selectedThreadId`
  - `toolbarState`
  - `localDraftStatus`
- [ ] 不要在 Zustand 中永久保存 `permissions`、`currentUser.role`、`reviewSession.ownerUserId` 作为权限判断依据。
- [ ] 页面初始化时用接口返回的 `display.mode` 设置默认显示模式。
- [ ] 切换最终模式时只影响展示，不修改 Lexical JSON。

## 8. 权限与锁定规则

- [ ] 后台接口返回 `permissions`，前端按字段控制按钮和编辑能力。
- [ ] `permissions.canEditContent = false` 时调用 `editor.setEditable(false)`。
- [ ] `permissions.canStartReview = false` 时隐藏或禁用“开启修订”按钮。
- [ ] `permissions.canStopReview = false` 时隐藏或禁用“结束修订”按钮。
- [ ] `permissions.canCreateComment = false` 时禁止新建划词批注。
- [ ] `permissions.canReplyComment = false` 时禁止回复批注。
- [ ] 修订模式开启后，作者端正文只读，但批注回复仍可用。
- [ ] 保存正文时带 `version` 或 `If-Match`，处理并发冲突。
- [ ] 修订会话需要心跳续约；组件卸载或关闭页面前停止心跳。
- [ ] 心跳超时或接口返回锁释放后，刷新编辑器权限。

## 9. 国际化接入

- [ ] 将编辑器内中文硬编码文案抽到后台系统 i18n 文件中。
- [ ] 建议命名空间为 `novelEditor`。
- [ ] 至少抽取这些文案：
  - `请输入正文...`
  - `开启修订`
  - `结束修订`
  - `审阅`
  - `最终`
  - `编辑正在修订，正文暂不可编辑`
  - `最终模式：删除修订已隐藏，新增修订按正文显示`
  - 保存成功、保存失败、版本冲突、内容锁定等提示
- [ ] 后台已有语言切换时，确认编辑器工具栏、状态栏、批注面板能同步切换。

## 10. shadcn/ui 与样式接入

- [ ] 优先复用后台系统的 `Button`、`DropdownMenu`、`Dialog`、`Tooltip`、`Tabs`、`Select`、`Switch`、`Separator`。
- [ ] 将当前自带 `Button.css`、`Dialog.css`、`Modal.css` 中能被 shadcn/ui 覆盖的样式逐步删除。
- [ ] 保留编辑器正文排版样式、修订痕迹样式、批注高亮样式。
- [ ] 将编辑器样式入口统一为：

```ts
import "@/modules/novel-editor/styles/editor.css";
```

- [ ] 检查 CSS 类名是否与后台系统全局样式冲突，必要时统一加前缀 `novel-editor-`。
- [ ] 适配后台系统主题变量，颜色优先使用 CSS variables：
  - `--background`
  - `--foreground`
  - `--border`
  - `--muted`
  - `--primary`
  - `--destructive`
- [ ] 检查深色模式下新增修订、删除修订、批注高亮是否可读。
- [ ] 检查移动端或窄屏下工具栏换行、批注面板展示、浮动工具条定位。

## 11. Mock 与本地联调

- [ ] 在后台项目 MSW 中新增 mock handlers：
  - `GET /api/chapters/:chapterId/editor`
  - `PUT /api/chapters/:chapterId/content`
  - `POST /api/chapters/:chapterId/review-sessions`
  - `POST /api/chapters/:chapterId/review-sessions/:sessionId/heartbeat`
  - `PATCH /api/chapters/:chapterId/review-sessions/:sessionId`
  - `POST /api/chapters/:chapterId/comment-threads`
  - `POST /api/comment-threads/:threadId/messages`
- [ ] 使用 Faker.js 生成章节标题、正文、作者、编辑、批注线程。
- [ ] Mock 至少覆盖以下场景：
  - 作者打开草稿，可编辑正文
  - 编辑开启修订，作者端正文只读
  - 编辑新增、删除文本后保存
  - 作者回复批注
  - 最终模式隐藏删除修订
  - 保存接口返回 `409 VERSION_CONFLICT`
  - 保存接口返回 `423 CONTENT_LOCKED`

## 12. 数据保存与序列化

- [ ] 加载章节时，将接口返回的 Lexical JSON 作为初始 editor state。
- [ ] 首次空正文时创建一个空 paragraph，避免编辑器不可聚焦。
- [ ] 保存时使用 Lexical `editor.getEditorState().toJSON()`。
- [ ] 保存前校验 `root.children` 是块级结构。
- [ ] 多行粘贴时按换行拆成多个 paragraph，不在单个文本节点中塞大段换行。
- [ ] 修订模式下新增内容写入 `SuggestionNode`，并带上：
  - `suggestionId`
  - `suggestionType`
  - `authorId`
  - `author`
  - `createdAt`
  - `status`
- [ ] 删除内容不直接从正文移除，而是包装成 `suggestionType = "deletion"`。
- [ ] 最终模式只做展示计算，不回写正文 JSON。

## 13. 批注接入

- [ ] 将当前 `CommentPlugin` 的本地 comment store 改成接口驱动。
- [ ] 创建批注时保存：
  - 选中文本 quote
  - Lexical markId
  - 文本快照版本 snapshotVersion
  - startOffset/endOffset 或可恢复定位信息
  - 首条评论 body
- [ ] 回复批注时调用接口创建 message。
- [ ] 删除、关闭、重新打开批注线程时调用后台接口，并刷新 React Query 缓存。
- [ ] 正文重新加载后，根据 `anchor.markId` 恢复批注高亮。
- [ ] 处理批注锚点失效情况，展示为“原文位置可能已变化”。

## 14. 构建与资源处理

- [ ] 移除当前项目 `vite.config.ts` 中 playground 专用多入口配置，不要照搬到后台系统。
- [ ] 如果迁移图片或图标，放到后台系统统一资源目录，例如 `src/assets/novel-editor/`。
- [ ] SVG 图标优先替换为后台系统已有 icon 或 lucide-react。
- [ ] 确认 Vite 构建不会把未使用的 playground 插件打进业务包。
- [ ] 使用路由级懒加载降低首屏包体：

```tsx
const ChapterEditorPage = lazy(() => import("@/pages/novels/ChapterEditorPage"));
```

- [ ] 构建后检查 chunk 体积；如编辑器体积过大，单独拆成 `novel-editor` chunk。

## 15. 测试与验收

- [ ] TypeScript 检查通过：

```bash
pnpm typecheck
```

- [ ] Lint 通过：

```bash
pnpm lint
```

- [ ] 构建通过：

```bash
pnpm build
```

- [ ] 手动验收作者流程：
  - 作者打开章节
  - 输入正文
  - 保存正文
  - 编辑修订期间作者正文只读
  - 作者可回复批注
- [ ] 手动验收编辑流程：
  - 编辑打开章节
  - 开启修订
  - 新增文本显示新增痕迹
  - 删除文本显示删除痕迹
  - 创建划词批注
  - 关闭修订
- [ ] 手动验收显示模式：
  - 审阅模式显示新增/删除痕迹
  - 最终模式隐藏删除内容
  - 切回审阅模式后修订痕迹仍存在
- [ ] 手动验收异常场景：
  - 无权限进入页面
  - 保存版本冲突
  - 内容锁定
  - 心跳超时
  - 网络失败后重试
- [ ] 检查响应式布局：
  - 1440px 桌面宽屏
  - 1024px 平板宽度
  - 375px 手机宽度

## 16. 推荐落地顺序

- [ ] 第 1 步：只迁移编辑器核心组件和样式，使用 MSW 假数据跑通页面。
- [ ] 第 2 步：接入 React Query 的章节加载与正文保存。
- [ ] 第 3 步：接入真实权限、正文锁和修订会话接口。
- [ ] 第 4 步：接入批注线程接口。
- [ ] 第 5 步：替换 toolbar/modal/button 为 shadcn/ui。
- [ ] 第 6 步：做 i18n、暗色模式、响应式和异常态细节。
- [ ] 第 7 步：补齐测试和验收记录。

## 17. 接入完成标准

- [ ] 后台系统中可以通过菜单进入章节编辑页。
- [ ] 编辑器不再依赖 `MockWorkflowContext`。
- [ ] 用户、权限、章节正文、版本号、批注、修订会话都来自真实接口或 MSW mock。
- [ ] 作者和编辑权限表现符合后台返回的 `permissions`。
- [ ] 正文保存、修订开启/关闭、批注创建/回复都能正常工作。
- [ ] 最终模式不修改原始 Lexical JSON。
- [ ] TypeScript、Lint、Build 全部通过。
- [ ] 桌面和移动端主要编辑流程可用。
