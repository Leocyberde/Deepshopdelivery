import React from 'react';
import { Bell, X, Check, MapPin, Truck } from 'lucide-react';
import {
  formatCurrency,
  formatDistance,
  formatDateTime,
  isItatibaCity,
} from '../../context/AppContext.tsx';

interface AdminNewCustomerAlertProps {
  adminNotifsData: {
    notifications: any[];
    unreadCount: number;
    activePopups: any[];
  };
  showAdminNotifsDrawer: boolean;
  setShowAdminNotifsDrawer: React.Dispatch<React.SetStateAction<boolean>>;
  notifFreightKmMap: Record<number, string>;
  notifFreightFeeMap: Record<number, string>;
  setNotifFreightFeeMap: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  savingNotifFreightId: number | null;
  handleMarkAllAdminNotifsRead: () => void;
  handleMarkAdminNotifRead: (notifId: number) => void;
  handleDismissAdminNotifPopup: (notifId: number) => void;
  handleNotifKmChange: (notifId: number, rawKm: string) => void;
  handleSaveFreightFromNotification: (notif: any) => void;
  openAddressFreightModal: (addr: any, customerName?: string) => void;
}

export const AdminNewCustomerAlert: React.FC<AdminNewCustomerAlertProps> = ({
  adminNotifsData,
  showAdminNotifsDrawer,
  setShowAdminNotifsDrawer,
  notifFreightKmMap,
  notifFreightFeeMap,
  setNotifFreightFeeMap,
  savingNotifFreightId,
  handleMarkAllAdminNotifsRead,
  handleMarkAdminNotifRead,
  handleDismissAdminNotifPopup,
  handleNotifKmChange,
  handleSaveFreightFromNotification,
  openAddressFreightModal,
}) => {
  const activePopups = Array.isArray(adminNotifsData?.activePopups)
    ? adminNotifsData.activePopups
    : [];
  const allNotifs = Array.isArray(adminNotifsData?.notifications)
    ? adminNotifsData.notifications
    : [];
  const topPopup = activePopups[0] || null;

  const renderNotifFreightForm = (notif: any) => {
    const addr = notif.address;
    if (!addr) {
      return (
        <div className="text-xs text-zinc-500">
          Este cliente ainda não possui endereço cadastrado.
        </div>
      );
    }

    const kmVal =
      notifFreightKmMap[notif.id] ??
      (addr.deliveryDistanceKm !== null && addr.deliveryDistanceKm !== undefined
        ? String(addr.deliveryDistanceKm)
        : '');
    const feeVal =
      notifFreightFeeMap[notif.id] ??
      (addr.deliveryFee !== null && addr.deliveryFee !== undefined
        ? String(addr.deliveryFee)
        : '');

    return (
      <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold text-zinc-900 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            <span>
              {addr.label}: {addr.street}, {addr.number}
              {addr.complement ? ` (${addr.complement})` : ''} — {addr.neighborhood}, {addr.city}/
              {addr.state} (CEP {addr.zipCode})
            </span>
          </div>
          {isItatibaCity(addr.city) ? (
            <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-900">
              Itatiba — Temos delivery
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-900">
              Fora de Itatiba — Correios via WhatsApp
            </span>
          )}
        </div>

        {addr.deliveryFeeStatus === 'CONFIRMED' && (
          <div className="text-[11px] font-semibold text-emerald-800">
            ✓ Frete já confirmado: {formatCurrency(addr.deliveryFee)} (Distância:{' '}
            {formatDistance(addr.deliveryDistanceKm)})
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
          <div className="sm:col-span-4 space-y-1">
            <label className="block text-[11px] font-semibold text-zinc-700">
              Distância (km)
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={kmVal}
              onChange={(e) => handleNotifKmChange(notif.id, e.target.value)}
              placeholder="Ex: 3.5"
              className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-stone-300 rounded-lg"
            />
          </div>
          <div className="sm:col-span-4 space-y-1">
            <label className="block text-[11px] font-semibold text-zinc-700">
              Valor do Frete (R$)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={feeVal}
              onChange={(e) =>
                setNotifFreightFeeMap((prev) => ({
                  ...prev,
                  [notif.id]: e.target.value,
                }))
              }
              placeholder="Ex: 7.50"
              className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-stone-300 rounded-lg"
            />
          </div>
          <div className="sm:col-span-4 flex items-center gap-2">
            <button
              type="button"
              disabled={savingNotifFreightId === notif.id}
              onClick={() => handleSaveFreightFromNotification(notif)}
              className="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {savingNotifFreightId === notif.id ? 'Salvando...' : 'Salvar Frete'}
            </button>
            <button
              type="button"
              onClick={() => openAddressFreightModal(addr, notif.customer?.name)}
              className="px-2.5 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-stone-300 hover:bg-stone-100 rounded-lg transition-colors"
            >
              Completo
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Pop-up imediato de Novo Cliente Cadastrado */}
      {topPopup && (
        <div className="p-4 rounded-xl bg-emerald-50/90 border-2 border-emerald-400 shadow-sm space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-700 text-white text-[10px] font-bold uppercase tracking-wide">
                <Truck className="w-3 h-3" />
                <span>{topPopup.type === 'NEW_ORDER' ? 'Novo Pedido' : topPopup.type === 'DATA_DELETION_REQUEST' ? 'Exclusão de Dados' : topPopup.type === 'SUPPORT_TICKET' ? 'Novo Atendimento' : topPopup.type === 'SUPPORT_MESSAGE' ? 'Nova Mensagem de Atendimento' : 'Novo Cliente Cadastrado'}</span>
              </div>
              <h3 className="text-sm font-bold text-zinc-900">{topPopup.title}</h3>
              <p className="text-xs text-zinc-700">{topPopup.message}</p>
              {topPopup.customer && ['NEW_CUSTOMER', 'DATA_DELETION_REQUEST'].includes(topPopup.type) && (
                <div className="text-xs text-zinc-600 font-medium">
                  Cliente: <strong>{topPopup.customer.name}</strong>
                  {topPopup.customer.cpf ? ` · CPF: ${topPopup.customer.cpf}` : ''} · Tel:{' '}
                  {topPopup.customer.phone}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleDismissAdminNotifPopup(topPopup.id)}
              className="p-1.5 text-zinc-500 hover:text-zinc-900 bg-white border border-stone-200 rounded-lg"
              title="Fechar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {topPopup.type === 'NEW_ORDER' ? (
            <div className="p-3.5 rounded-xl bg-white border border-amber-200 space-y-2 text-xs">
              <div className="font-bold text-zinc-900">Pedido {topPopup.order?.orderNumber ? `#${topPopup.order.orderNumber}` : ''}</div>
              {topPopup.order && <div className="text-zinc-700">Total: <strong>R$ {Number(topPopup.order.total || 0).toFixed(2).replace('.', ',')}</strong> · {topPopup.order.itemCount || 0} item(ns)</div>}
              <button type="button" onClick={() => handleMarkAdminNotifRead(topPopup.id)} className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white font-semibold">Marcar como lido</button>
            </div>
          ) : topPopup.type === 'DATA_DELETION_REQUEST' ? (
            <div className="p-3.5 rounded-xl bg-white border border-red-200 text-xs text-red-900 space-y-2">
              <div className="font-bold">Revisar solicitação de exclusão</div>
              <p>Abra a área de Clientes para revisar a conta e tratar a solicitação conforme a LGPD.</p>
              <button type="button" onClick={() => handleMarkAdminNotifRead(topPopup.id)} className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white font-semibold">Marcar como lido</button>
            </div>
          ) : topPopup.type === 'SUPPORT_TICKET' || topPopup.type === 'SUPPORT_MESSAGE' ? (
            <div className="p-3.5 rounded-xl bg-white border border-blue-200 text-xs text-blue-950 space-y-2">
              <div className="font-bold">Atendimento na Central de Ajuda</div>
              <p>Abra a Central de Ajuda no painel administrativo para ler e responder. O conteúdo da conversa não é incluído nesta notificação.</p>
              <button type="button" onClick={() => handleMarkAdminNotifRead(topPopup.id)} className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white font-semibold">Marcar como lido</button>
            </div>
          ) : renderNotifFreightForm(topPopup)}
        </div>
      )}

      {/* Gaveta / Lista de Notificações de Novos Clientes */}
      {showAdminNotifsDrawer && (
        <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-zinc-800" />
              <h3 className="text-sm font-bold text-zinc-900">
                Histórico de Notificações Admin ({allNotifs.length})
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {adminNotifsData.unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllAdminNotifsRead}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-zinc-800 bg-stone-100 hover:bg-stone-200 rounded-lg"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Marcar todas como lidas</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowAdminNotifsDrawer(false)}
                className="p-1.5 text-zinc-500 hover:text-zinc-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {allNotifs.length === 0 ? (
            <div className="text-xs text-zinc-500 py-4 text-center">
              Nenhuma notificação administrativa registrada até o momento.
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {allNotifs.map((notif) => (
                <div
                  key={notif.id}
                  className={`p-3.5 rounded-xl border space-y-2.5 ${
                    notif.isRead
                      ? 'bg-white border-stone-200'
                      : 'bg-emerald-50/40 border-emerald-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 text-xs">
                        {!notif.isRead && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-700 text-white text-[10px] font-bold">
                            NOVO
                          </span>
                        )}
                        <span className="font-bold text-zinc-900">{notif.title}</span>
                        <span className="text-zinc-400">·</span>
                        <span className="text-zinc-500 tabular-nums">
                          {formatDateTime(notif.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-600 mt-0.5">{notif.message}</p>
                    </div>
                    {!notif.isRead && (
                      <button
                        type="button"
                        onClick={() => handleMarkAdminNotifRead(notif.id)}
                        className="px-2.5 py-1 text-[11px] font-medium text-zinc-700 bg-stone-100 hover:bg-stone-200 rounded-md shrink-0"
                      >
                        Marcar lida
                      </button>
                    )}
                  </div>

                  {notif.type === 'NEW_CUSTOMER' ? renderNotifFreightForm(notif) : notif.type === 'NEW_ORDER' ? (
                    <div className="text-xs text-zinc-700">Pedido {notif.order?.orderNumber ? `#${notif.order.orderNumber}` : ''} · Total: R$ {Number(notif.order?.total || 0).toFixed(2).replace('.', ',')} · {notif.order?.itemCount || 0} item(ns)</div>
                  ) : notif.type === 'SUPPORT_TICKET' || notif.type === 'SUPPORT_MESSAGE' ? (
                    <div className="text-xs text-blue-900">Abra a Central de Ajuda no painel para visualizar e responder sem expor o conteúdo em notificações.</div>
                  ) : (
                    <div className="text-xs text-red-800">Solicitação pendente: revise o cliente na área de Clientes.</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
};
