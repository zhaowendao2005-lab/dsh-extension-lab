# 实验底座执行计划（实现阶段）

本阶段只验证两件事：插件包能生成可加载的 Host entry；外部 driver 能严格记录 headless 进程的 stdout/stderr/exit code/final reason，并在缺少最终事件时判为失败或 unknown，而不是通过。

不运行真实模型、不安装插件、不改共享 profile、不执行 Playwright、不产生账单。后续真实实验需单独批准：隔离 profile、固定模型/凭据、任务样本、重复次数和预算。
