import type * as ReactTypes from 'react';

const React = {} as typeof ReactTypes;

export default React;

export function setReact(value: typeof ReactTypes): void {
  Object.assign(React, value);
}
