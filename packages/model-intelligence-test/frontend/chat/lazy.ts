import type * as ReactTypes from 'react';
import React from '../runtime';

/**
 * 宿主的 React 只在 __ModuleLoader__ 装载 factory 后注入，模块求值期 `runtime` 的 React 仍是空对象，
 * 所以本目录内不得在模块顶层调用 React.memo / forwardRef / createContext（会在加载时抛错）。
 * memo 只是性能优化，直接返回组件即可。
 */
export function memo<T>(component: T): T {
  return component;
}

/** 首次渲染时才创建 Context，避免模块顶层取到空的 React。 */
export function lazyContext<T>(initial: T): () => ReactTypes.Context<T> {
  let context: ReactTypes.Context<T> | null = null;
  return () => (context ??= React.createContext<T>(initial));
}
