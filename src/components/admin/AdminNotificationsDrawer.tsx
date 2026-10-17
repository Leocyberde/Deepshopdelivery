import React from 'react';
import { formatDateTime } from '../../context/AppContext.tsx';
export const AdminNotificationsDrawer: React.FC<{ adminNotifsData: { notifications: any[]; activePopups: any[] }; showAdminNotifsDrawer: boolean; setShowAdminNotifsDrawer: (show: boolean) => void; handleMarkAllAdminNotifsRead: () => void; handleMarkAdminNotifRead: (id: number) => void; handleDismissAdminNotifPopup: (id: number) => void }> = (props) => {
  const top = props.adminNotifsData.activePopups?.[0];
  return <>
    {top && !props.showAdminNotifsDrawer && <aside className="rounded-xl border bg-white p-4 space-y-2"><strong className="text-sm">{top.title}</strong><p className="text-xs">{top.message}</p><button type="button" onClick={() => props.handleDismissAdminNotifPopup(top.id)} className="text-xs underline">Dispensar aviso</button></aside>}
    {props.showAdminNotifsDrawer && <aside className="rounded-xl border bg-white p-4 space-y-3"><div className="flex justify-between"><h2 className="font-semibold">Notificações</h2><button type="button" onClick={() => props.setShowAdminNotifsDrawer(false)} className="text-xs underline">Fechar</button></div><button type="button" onClick={props.handleMarkAllAdminNotifsRead} className="text-xs underline">Marcar todas como lidas</button>{props.adminNotifsData.notifications?.map((notification) => <article key={notification.id} className="rounded-lg border p-3"><strong className="text-sm">{notification.title}</strong><p className="text-xs mt-1">{notification.message}</p><div className="text-[11px] mt-2">{formatDateTime(notification.createdAt)} · <button type="button" onClick={() => props.handleMarkAdminNotifRead(notification.id)} className="underline">Marcar lida</button></div></article>)}</aside>}
  </>;
};
