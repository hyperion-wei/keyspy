# 更新日志

## v1.25.0 (2026-07-01)

### 新功能
- **Hunt 扫描引擎增强**
  - 新增 3 条 JSON apiKey 增强规则（sk- 前缀 / UUID 格式 / 通用长字符串）
  - 新增 Provider 识别：火山引擎 (volcengine)、SiliconFlow、百川、Moonshot、智谱 AI、零一万物、StepFun
  - 增强上下文推断逻辑，支持更多国内大模型厂商关键词
  - 同文件多 Key 聚合，去重优化

### 修复
- **修复 AI 分析覆盖 bug**：`analyzeFindings` 中 AI 返回的 `key_value`（如占位符 "minimax-oauth"）不再无条件覆盖 gitleaks 正确提取的密钥值，仅在 AI 返回更长且更可信时才覆盖
- 修复 `classifyFinding` 对未知 Provider 的降级处理

### 改进
- 添加完整的单元测试体系（Vitest），覆盖 checker、hunt-registry、scan-regex 等核心模块
- 添加端到端扫描测试脚本 `test-hunt-scan.js`

---

## v1.24.0 (2026-06-28)

### 新功能
- **账户管理**：多用户管理，支持 admin/user 角色控制
- **批量模型测试**：对扫描发现的 Key 一键批量可用性测试
- **扫描结果编辑**：支持编辑扫描结果中的 provider、model、base_url 字段
- **同文件聚合**：同一文件发现的多个 Key 自动聚合展示

### 改进
- 更新项目截图，敏感信息已脱敏
- 修复 GitHub 链接指向

---

## v1.23.0 (2026-06-26)

### 新功能
- **Hunt 扫描模块**：全网敏感信息发现扫描引擎
  - gitleaks 默认 + 自定义增强规则双重扫描
  - AI 辅助分类与 Provider 识别
  - 扫描任务进度实时展示
- **监控配置模板**：创建可复用模板，快速批量部署
- **分组视图**：按 Provider 分组查看监控状态

### 改进
- 项目更名为 KeySpy，全新品牌标识

---

## v1.0.0 (2026-06-20)

### 首次发布
- **API 可用性监控**：LLM API 端点定时检测
- **仪表盘**：实时监控状态总览、可用性趋势图
- **模板管理**：监控配置 CRUD
- **LLM 配置管理**：Chat 模型配置（支持 OpenAI / Anthropic / Google）
- **认证系统**：Session Cookie 登录，SQLite 用户存储
- **暗色/亮色主题**：自动根据时间切换
- **响应式布局**：支持桌面和移动端
