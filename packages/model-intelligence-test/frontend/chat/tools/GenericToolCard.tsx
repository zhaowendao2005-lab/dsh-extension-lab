/**
 * The fallback tool view: every call that no keyed toolview claims.
 *
 * Port of ui-tool/src/client/tool/toolviews/GenericToolCard.tsx. The DSH version
 * derives a row model from the live `ToolCallBlock` and adds terminal/read/diff/
 * search/web cards; the mirror has only the recorded triple, so the model comes
 * from `toolRowModel` and every call renders the generic card. Icon table, title
 * resolution and the row wiring are the original ones.
 */

import React from '../../runtime';
import type { ReactNode } from 'react';
import {
  IconApiOutlineRegular, IconBrowseOutlineRegular, IconCodeOutlineRegular, IconEditOutlineRegular, IconSearchOutlineRegular,
  IconSparkleRegular,
} from './icons';
import { label } from './labels';
import { toolRowModel, type ToolRowVariant } from './row-model';
import { fileContextMenuProps, inspectCall, openFile, urlContextMenuProps } from './actions';
import { ToolRow } from './ToolRow';
import { type UseDisclosure } from './useDisclosure';

/** Variant leading icons (figma table); all glyphs render at 14 inside the 16px leading box. */
const VARIANT_ICONS: Record<ToolRowVariant, () => ReactNode> = {
  search: () => <IconSearchOutlineRegular size={14} />,
  read: () => <IconBrowseOutlineRegular size={14} />,
  bash: () => <IconApiOutlineRegular size={14} />,
  write: () => <IconEditOutlineRegular size={14} />,
  edit: () => <IconEditOutlineRegular size={14} />,
  code: () => <IconCodeOutlineRegular size={14} />,
  others: () => <IconSparkleRegular size={14} />,
};

/** One recorded call plus the render site's disclosure seat. */
export interface GenericToolCardProps {
  /** Wire tool name, for example `sandbox_writeFile`. */
  name: string;
  /** Recorded lifecycle state. */
  status: 'running' | 'ok' | 'error';
  /** Formatted argument JSON, or null before arguments were recorded. */
  arguments: string | null;
  /** Recorded result text, or null while running. */
  content: string | null;
  /** Bind one disclosure seat per row. */
  useDisclosure: UseDisclosure;
}

/** @param props - recorded call and disclosure seat. @returns its generic tool row. */
export function GenericToolCard({ name, status, arguments: argsRaw, content, useDisclosure }: GenericToolCardProps) {
  const model = toolRowModel(name, status, argsRaw, content);
  return (
    <ToolRow
      fileContextMenuProps={model.filePath === undefined ? undefined : fileContextMenuProps(model.filePath)}
      urlContextMenuProps={model.href === undefined ? undefined : urlContextMenuProps(model.href)}
      useDisclosure={useDisclosure}
      variant={model.variant}
      toolName={name}
      icon={VARIANT_ICONS[model.variant]()}
      title={label(model.titleKey)}
      summary={model.summary}
      bodyRaw={model.bodyRaw}
      output={model.output}
      errorSummary={model.errorSummary}
      state={model.state}
      filePath={model.filePath}
      onOpenFile={model.filePath === undefined ? undefined : openFile}
      href={model.href}
      inspect={() => inspectCall(name)}
    />
  );
}
