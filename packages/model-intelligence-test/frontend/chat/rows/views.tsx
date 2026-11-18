/**
 * Public surface of the vendored chat rows: one view per mirrored row type plus
 * the flow container their spacing rules hang off.
 *
 * A row view renders the reference node's own markup inside the flow item shell
 * that DSH's chat seat wrapped every node in (`ChatNodeSeat`): the shell carries
 * `data-chat-flow-kind` / `data-chat-group-part`, which is exactly what the
 * `ChatView.module.css` sibling rules key their row gaps on. A mirror row is
 * built from `ChatRow` (see `../model`), so each view maps one row onto the node
 * view that renders that content in DSH.
 */
import React from '../../runtime';
import { chatviewCss as css } from './classes';
import { AssistantNodeView } from './AssistantNodeView';
import { TurnErrorItem, UserMessageNodeView } from './MessageItem';
import { ReasoningRow } from './ReasoningRow';
import { TurnTailNodeView } from './TurnTailNodeView';
import { ChatTurnUsagePanel } from './TurnUsageRow';
import { chatRowActions } from './actions';
import type {
  ChatAssistantRow, ChatErrorRow, ChatReasoningRow, ChatTurnRow, ChatTurnUsageRow, ChatUserRow,
} from '../model';

/**
 * Flow item wrapper: the per-node shell the chat seat rendered around every
 * node, so the flow's sibling gap rules apply unchanged.
 * @param props.kind - node kind carried as `data-chat-flow-kind`.
 * @param props.groupPart - reasoning or response part of a split assistant message.
 * @param props.rowKey - stable row identity carried as `data-chat-node-key`.
 * @param props.children - the node markup.
 * @returns the flow item.
 */
function FlowItem({ kind, groupPart, rowKey, turn, children }: {
  kind: string;
  groupPart?: 'reasoning' | 'response' | undefined;
  rowKey: string;
  turn?: number | undefined;
  children: React.ReactNode;
}) {
  // Same key derivation as the chat seat: the response part and ungrouped rows
  // key on the node alone, a reasoning part keys on the pair.
  const flowKey = groupPart === undefined || groupPart === 'response' ? rowKey : JSON.stringify([rowKey, groupPart]);
  return (
    <div
      className={css.flowItem}
      data-chat-anchor-key={flowKey}
      data-chat-flow-key={flowKey}
      data-chat-paging-anchor=""
      data-chat-node-key={rowKey}
      data-chat-group-part={groupPart}
      data-chat-flow-kind={kind}
      data-chat-turn={turn}
    >
      <div data-mit-chat-node="">
        {children}
      </div>
    </div>
  );
}

/**
 * Render one user message row.
 * @param props.row - mirrored user row.
 * @returns the flow item holding the user message.
 */
export function ChatUserRowView({ row }: { row: ChatUserRow }): React.JSX.Element {
  return (
    <FlowItem kind="user" rowKey={row.id}>
      {/* The reference user row carries copy + clock only; branch lives on the
          turn tail, so no branch control is added here. */}
      <UserMessageNodeView content={{ text: row.text }} time={row.at} />
    </FlowItem>
  );
}

/**
 * Render one assistant text row.
 * @param props.row - mirrored assistant row.
 * @returns the flow item holding the assistant body.
 */
export function ChatAssistantRowView({ row }: { row: ChatAssistantRow }): React.JSX.Element {
  return (
    <FlowItem kind="assistant-step" groupPart="response" rowKey={row.id}>
      <AssistantNodeView text={row.text} running={row.running} />
    </FlowItem>
  );
}

/**
 * Render one reasoning row as a split `reasoning` part of the assistant message.
 * @param props.row - mirrored reasoning row.
 * @returns the flow item holding the disclosure row.
 */
export function ChatReasoningRowView({ row }: { row: ChatReasoningRow }): React.JSX.Element {
  return (
    <FlowItem kind="assistant-step" groupPart="reasoning" rowKey={row.id}>
      <ReasoningRow text={row.text} running={row.running} textInteractionSource={!row.running} />
    </FlowItem>
  );
}

/**
 * Render one turn failure row.
 * @param props.row - mirrored error row.
 * @returns the flow item holding the error notice.
 */
export function ChatErrorRowView({ row }: { row: ChatErrorRow }): React.JSX.Element {
  return (
    <FlowItem kind="turn-error" rowKey={row.id}>
      <TurnErrorItem node={{ message: row.text, code: row.code === null ? undefined : row.code }} />
    </FlowItem>
  );
}

/**
 * Render the actions tail that closes one turn.
 * @param props.row - mirrored turn row.
 * @returns the flow item holding the turn tail.
 */
export function ChatTurnRowView({ row }: { row: ChatTurnRow }): React.JSX.Element {
  return (
    <FlowItem kind="turn-tail" rowKey={row.id} turn={row.turn}>
      <TurnTailNodeView
        turn={row.turn}
        time={row.at}
        // TODO(host): real fork intake; the control keeps its place meanwhile.
        onBranch={() => { chatRowActions.branchAt(row.id); }}
      />
    </FlowItem>
  );
}

/**
 * Render the usage summary that closes one turn (DSH `TurnUsagePanel` inside the
 * turn tail), as its own `turn-tail` flow item so the tail spacing rules apply.
 * @param props.row - mirrored turn usage row.
 * @returns the flow item holding the usage pill.
 */
export function ChatTurnUsageRowView({ row }: { row: ChatTurnUsageRow }): React.JSX.Element {
  return (
    <FlowItem kind="turn-tail" rowKey={row.id} turn={row.turn}>
      <ChatTurnUsagePanel turn={row.turn} usage={row.usage} />
    </FlowItem>
  );
}

/**
 * Render the transcript flow: the centred column the chat view put its flow
 * slot in, plus that slot's own wrapper (renamed `data-mit-chat-flow` so host
 * stylesheets cannot reach it). The row-gap rules key on both levels, so the
 * wrapper stays.
 * @param props.children - row views, in transcript order.
 * @returns the flow column with its row wrapper.
 */
export function ChatFlow({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className={css.column} data-chat-flow="">
      <div data-mit-chat-flow="">
        {children}
      </div>
    </div>
  );
}
