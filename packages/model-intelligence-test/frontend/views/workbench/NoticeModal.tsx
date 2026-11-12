import React,{ useEffect,useRef,useStore } from '../../runtime';
import type { Workbench } from '../../types';
export function NoticeModal({ store }: {
  store: Workbench;
}) {
  const notice=useStore(store.notice,value => value);
  const dialog=useRef<HTMLDivElement>(null);
  useEffect(() => {
    if(!notice)
      return;
    const previous=document.activeElement instanceof HTMLElement? document.activeElement:null;
    dialog.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => { previous?.focus(); };
  },[notice?.title,notice?.input!==undefined]);
  if(!notice)
    return null;
  return <div className="mit-modal-backdrop">
    <div ref={dialog} className="mit-modal" role="dialog" aria-modal="true" aria-labelledby={`${store.sessionId}-mit-notice-title`} aria-describedby={`${store.sessionId}-mit-notice-message`} onKeyDown={event => {
      if(event.key==='Escape') {
        event.preventDefault();
        const cancel=notice.choices.find(choice => /cancel|no|dismiss/.test(choice.id))||(notice.choices.length===1? notice.choices[0]:undefined);
        if(cancel)
          store.actions.answerNotice(cancel.id);
      }
      if(event.key!=='Tab')
        return;
      const items=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')||[]);
      const first=items[0],last=items[items.length-1];
      if(event.shiftKey&&document.activeElement===first) {
        event.preventDefault();
        last?.focus();
      }
      else if(!event.shiftKey&&document.activeElement===last) {
        event.preventDefault();
        first?.focus();
      }
    }}>
      <h2 id={`${store.sessionId}-mit-notice-title`}>
        {notice.title}
      </h2>
      <p id={`${store.sessionId}-mit-notice-message`}>
        {notice.message}
      </p>
      {notice.input!==undefined&&<label className="mit-field">名称
        <input value={notice.input} onChange={event => store.actions.setNoticeInput(event.currentTarget.value)} onKeyDown={event => {
          if(event.key==='Enter') {
            const choice=notice.choices.find(item => !/cancel|no|dismiss/.test(item.id));
            if(choice)
              store.actions.answerNotice(choice.id);
          }
        }} />
      </label>}
      <div className="mit-modal-actions">
        {notice.choices.map(choice => <button type="button" className={choice.danger? 'mit-button mit-danger':'mit-button'} key={choice.id} onClick={() => store.actions.answerNotice(choice.id)}>
          {choice.label}
        </button>)}
      </div>
    </div>
  </div>;
}
