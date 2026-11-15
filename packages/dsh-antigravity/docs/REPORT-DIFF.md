# 抓包差异（机器生成）

## 1. 内容请求 summarise

- **http_version**: CLI=`"HTTP/1.1"` | plugin=`"HTTP/1.1"`
- **url**: CLI=`"https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse"` | plugin=`"https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse"`
- **ua**: CLI=`"antigravity/cli/1.5.9 (aidev_client; os_type=darwin; arch=arm64; cl=1021519450; auth_method=consumer)"` | plugin=`"antigravity/hub/2.28.0 (aidev_client; os_type=darwin; arch=arm64; cl=1008300195)"`
- **transfer_encoding**: CLI=`"chunked"` | plugin=`null`
- **content_length**: CLI=`null` | plugin=`"846"`
- **extra_headers**: CLI=`[]` | plugin=`["accept", "accept-language", "sec-fetch-mode"]`
- **envelope_keys**: CLI=`["project", "requestId", "request", "model", "userAgent", "requestType", "enabledCreditTypes"]` | plugin=`["project", "requestId", "request", "model", "userAgent", "requestType"]`
- **request_keys**: CLI=`["contents", "systemInstruction", "tools", "labels", "generationConfig", "sessionId"]` | plugin=`["contents", "systemInstruction", "tools", "labels", "generationConfig", "sessionId"]`
- **contents_roles**: CLI=`["user"]` | plugin=`["user"]`
- **session_id**: CLI=`"-3750763034362895579"` | plugin=`"5690180753864177140"`
- **response_status**: CLI=`200` | plugin=`200`
- **response_model_version**: CLI=`"gemini-3.8-flash-n"` | plugin=`"gemini-3.8-flash-n"`
- **prompt_tokens**: CLI=`9568` | plugin=`41`

## 2. 请求头矩阵

| header | CLI | plugin |
|---|---|---|
| `accept` | — | */* |
| `accept-encoding` | gzip | gzip |
| `accept-language` | — | * |
| `authorization` | Bearer <267 chars> | Bearer <267 chars> |
| `connection` | — | keep-alive |
| `content-length` | — | 846 |
| `content-type` | application/json | application/json |
| `host` | daily-cloudcode-pa.googleapis.com | daily-cloudcode-pa.googleapis.com |
| `sec-fetch-mode` | — | cors |
| `transfer-encoding` | chunked | — |
| `user-agent` | antigravity/cli/1.5.9 (aidev_client; os_type=darwin; arch=arm64; cl=1021519450; auth_method=consumer) | antigravity/hub/2.28.0 (aidev_client; os_type=darwin; arch=arm64; cl=1008300195) |

## 3. envelope / labels / generationConfig

```json
// CLI envelope (request 之外的键)
{
  "project": "aicode-consumers",
  "requestId": "agent/d10f4840-91c6-4c66-b5c4-37b207e8e82b/1794669917109/c25547a6-ad5a-4bf4-a7df-85d13cf7705c/1",
  "model": "gemini-3.8-flash-low",
  "userAgent": "antigravity",
  "requestType": "agent",
  "enabledCreditTypes": [
    "GOOGLE_ONE_AI"
  ]
}
// plugin envelope
{
  "project": "aicode-consumers",
  "requestId": "agent/3a99bf60c029e97f/1794670158541/b1347d0f/1",
  "model": "gemini-3.8-flash-low",
  "userAgent": "antigravity",
  "requestType": "agent"
}
// CLI labels
{
  "cascade_id": "d10f4840-91c6-4c66-b5c4-37b207e8e82b",
  "last_step_index": "0",
  "model_enum": "MODEL_PLACEHOLDER_M320",
  "request_id": "c25547a6-ad5a-4bf4-a7df-85d13cf7705c-0",
  "root_cascade_id": "d10f4840-91c6-4c66-b5c4-37b207e8e82b",
  "trajectory_id": "c25547a6-ad5a-4bf4-a7df-85d13cf7705c",
  "used_claude": "false",
  "used_claude_conservative": "false",
  "used_non_gemini_model": "false"
}
// plugin labels
{
  "last_step_index": "0",
  "model_enum": "gemini-3.8-flash-low",
  "request_id": "b1347d0f-0",
  "trajectory_id": "b1347d0f",
  "used_claude": "false",
  "used_claude_conservative": "false",
  "used_non_gemini_model": "false"
}
// CLI generationConfig
{
  "maxOutputTokens": 65536,
  "thinkingConfig": {
    "includeThoughts": true,
    "thinkingLevel": "LOW"
  }
}
// plugin generationConfig
{
  "thinkingConfig": {
    "includeThoughts": true,
    "thinkingLevel": "LOW"
  }
}
```

## 4. tools

- CLI: groups=14 decls=14 first6=['read_file', 'run_command', 'manage_task', 'send_message', 'schedule', 'invoke_subagent'] type_case=OBJECT
- plugin: groups=1 decls=1 first6=['noop'] type_case=OBJECT

## 5. 端点矩阵（请求条数 / 请求体字节数）

| endpoint | CLI | plugin |
|---|---|---|
| `(ignored: assets/avatar/github)` | 4x / [] | — |
| `GET aicode.googleapis.com/v1alpha:fetchConfig` | 3x / [0] | — |
| `GET www.googleapis.com/oauth2/v2/userinfo` | 2x / [0] | — |
| `POST daily-cloudcode-pa.googleapis.com/v1internal:fetchAdminControls` | 1x / [30] | — |
| `POST daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels` | 1x / [30] | 1x / [30] |
| `POST daily-cloudcode-pa.googleapis.com/v1internal:fetchUserInfo` | 2x / [30] | — |
| `POST daily-cloudcode-pa.googleapis.com/v1internal:listExperiments` | 1x / [30] | — |
| `POST daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist` | 4x / [38] | 1x / [83] |
| `POST daily-cloudcode-pa.googleapis.com/v1internal:recordTrajectoryAnalytics` | 1x / [116041] | — |
| `POST daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary` | 4x / [30] | 1x / [30] |
| `POST daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent` | 1x / [41933] | 2x / [846] |
| `POST daily-cloudcode-pa.googleapis.com/v1internal:writeTrajectoryAcls` | 1x / [55] | 2x / [27] |
| `POST play.googleapis.com/log` | 4x / [147, 2334, 406619, 569156] | — |

## 6. 同名端点的请求体对照

（内容请求字段级差异见 REPORT.md §5；此处只列辅助端点）


### `/v1internal:fetchAvailableModels`

- CLI: ['{"project":"aicode-consumers"}']
- plugin: ['{"project":"aicode-consumers"}']

### `/v1internal:loadCodeAssist`

- CLI: ['{"metadata":{"ideType":"ANTIGRAVITY"}}']
- plugin: ['{"cloudaicompanionProject":"aicode-consumers","metadata":{"ideType":"ANTIGRAVITY"}}']

### `/v1internal:retrieveUserQuotaSummary`

- CLI: ['{"project":"aicode-consumers"}']
- plugin: ['{"project":"aicode-consumers"}']

### `/v1internal:writeTrajectoryAcls`

- CLI: ['{"trajectoryId":"c25547a6-ad5a-4bf4-a7df-85d13cf7705c"}']
- plugin: ['{"trajectoryId":"8922081a"}', '{"trajectoryId":"b1347d0f"}']
