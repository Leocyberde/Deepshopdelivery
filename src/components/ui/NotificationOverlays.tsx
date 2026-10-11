import React from 'react';
import { Link } from 'react-router-dom';
import { Bell, X } from 'lucide-react';
import { CustomerNotification, ToastMessage, ORDER_STATUS_LABELS } from '../../types/app.ts';
import { formatDateTime, formatOrderNumberLabel } from '../../utils/formatters.ts';

export const CustomerNotificationPopupModal: React.FC<{
  notification: CustomerNotification | null;
  totalActivePopupsCount: number;
  onDismiss: (id: number) => void;
  onMarkRead: (id: number) => void;
}> = ({ notification, totalActivePopupsCount, onDismiss, onMarkRead }) => {
  if (!notification) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-notif-popup-title"
    >
      <div className="relative w-full max-w-md bg-white border border-stone-200 rounded-2xl shadow-xl p-6 space-y-4">
        {/* Botão de X para fechar o pop-up */}
        <button
          type="button"
          onClick={() => onDismiss(notification.id)}
          aria-label="Fechar notificação"
          title="Fechar notificação (X)"
          className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-stone-100 hover:bg-stone-200 text-zinc-700 hover:text-zinc-900 flex items-center justify-center font-bold transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 pr-8">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                {notification.newStatus === 'FIRST_ORDER_FREE_WELCOME'
                  ? 'Boas-Vindas · Entrega Grátis no 1° Pedido'
                  : 'Notificação da Loja'}
              </span>
              {totalActivePopupsCount > 1 && (
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-zinc-600">
                  1 de {totalActivePopupsCount}
                </span>
              )}
            </div>
            <h3
              id="order-notif-popup-title"
              className="text-base font-bold text-zinc-900 leading-snug"
            >
              {notification.title}
            </h3>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-mono font-bold text-emerald-950">
              {notification.newStatus === 'FIRST_ORDER_FREE_WELCOME'
                ? '🎁 1° Pedido Grátis'
                : formatOrderNumberLabel(notification.orderNumber)}
            </span>
            <span aria-hidden="true">·</span>
            {notification.oldStatus && (
              <>
                <span className="text-zinc-500">
                  {ORDER_STATUS_LABELS[notification.oldStatus] || notification.oldStatus}
                </span>
                <span className="text-zinc-400">→</span>
              </>
            )}
            <span className="px-2 py-0.5 rounded bg-emerald-700 text-white font-semibold">
              {ORDER_STATUS_LABELS[notification.newStatus] || notification.newStatus}
            </span>
          </div>
          <p className="text-xs text-zinc-800 leading-relaxed font-medium">{notification.message}</p>
          <div className="text-[11px] text-zinc-500 tabular-nums">
            Atualizado em {formatDateTime(notification.createdAt)}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            {notification.newStatus === 'FIRST_ORDER_FREE_WELCOME' ? (
              <Link
                to="/"
                onClick={() => onMarkRead(notification.id)}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
              >
                Ir para a Vitrine (Fazer 1° Pedido Grátis)
              </Link>
            ) : (
              <Link
                to="/minha-conta/pedidos"
                onClick={() => onMarkRead(notification.id)}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Ver Meu Pedido
              </Link>
            )}
            <Link
              to="/minha-conta/notificacoes"
              onClick={() => onMarkRead(notification.id)}
              className="px-3.5 py-2 text-xs font-semibold text-zinc-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
            >
              Aba de Notificações
            </Link>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(notification.id)}
            className="px-3 py-2 text-xs font-semibold text-zinc-600 hover:text-zinc-900 transition-colors cursor-pointer"
          >
            Fechar (X)
          </button>
        </div>
      </div>
    </div>
  );
};

export const ToastStack: React.FC<{ toasts: ToastMessage[] }> = ({ toasts }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto px-4 py-3 rounded-lg shadow-md border text-sm font-medium flex items-center justify-between transition-all ${
            t.type === 'error'
              ? 'bg-red-950 text-red-50 border-red-800'
              : t.type === 'success'
              ? 'bg-zinc-900 text-white border-zinc-800'
              : 'bg-white text-zinc-900 border-zinc-200'
          }`}
        >
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
};
