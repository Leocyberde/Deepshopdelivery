import React, { useState, useEffect, useRef } from 'react';
import { Clock } from 'lucide-react';

interface PaymentTimerBadgeProps {
  paymentExpiresAt?: string | null;
  status: string;
  paymentReleased?: boolean;
  onExpired?: () => void;
  compact?: boolean;
}

export const PaymentTimerBadge: React.FC<PaymentTimerBadgeProps> = ({
  paymentExpiresAt,
  status,
  paymentReleased = true,
  onExpired,
  compact = false,
}) => {
  const isUnpaid = status === 'NEW' || status === 'AWAITING_PAYMENT';
  const [remainingSec, setRemainingSec] = useState<number | null>(() => {
    if (!paymentExpiresAt) return null;
    const diff = Math.floor((new Date(paymentExpiresAt).getTime() - Date.now()) / 1000);
    return Math.max(0, diff);
  });
  const firedExpiredRef = useRef(false);
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  useEffect(() => {
    firedExpiredRef.current = false;
    if (!isUnpaid || !paymentExpiresAt) {
      setRemainingSec(null);
      return;
    }

    const updateTimer = () => {
      const diff = Math.floor((new Date(paymentExpiresAt).getTime() - Date.now()) / 1000);
      if (diff <= 0) {
        setRemainingSec(0);
        if (!firedExpiredRef.current) {
          firedExpiredRef.current = true;
          if (onExpiredRef.current) {
            setTimeout(() => onExpiredRef.current?.(), 600);
          }
        }
      } else {
        setRemainingSec(diff);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [isUnpaid, paymentExpiresAt]);

  if (!isUnpaid) return null;

  if (!paymentReleased) {
    if (compact) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-900">
          <Clock className="w-3 h-3 text-amber-700 shrink-0" />
          <span>Aguardando frete para iniciar prazo de 1h</span>
        </span>
      );
    }
    return (
      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-950">
        <Clock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <div className="font-bold">
            Estoque reservado! Aguardando a loja definir o valor do frete.
          </div>
          <div className="text-amber-900 mt-0.5">
            Assim que a loja confirmar o frete do seu endereço, você receberá uma notificação e o
            pagamento será liberado com prazo de 1 hora.
          </div>
        </div>
      </div>
    );
  }

  if (remainingSec === null) return null;

  const hours = Math.floor(remainingSec / 3600);
  const minutes = Math.floor((remainingSec % 3600) / 60);
  const seconds = remainingSec % 60;
  const formattedTime =
    hours > 0
      ? `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
      : `${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;

  const isUrgent = remainingSec <= 10 * 60; // últimos 10 minutos

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold tabular-nums border ${
          remainingSec <= 0
            ? 'bg-red-50 border-red-200 text-red-800'
            : isUrgent
            ? 'bg-red-50 border-red-200 text-red-800'
            : 'bg-amber-50 border-amber-200 text-amber-900'
        }`}
      >
        <Clock className="w-3 h-3 shrink-0" />
        <span>
          {remainingSec <= 0
            ? 'Prazo de 1h expirado'
            : `Reserva expira em ${formattedTime}`}
        </span>
      </span>
    );
  }

  return (
    <div
      className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-xs ${
        remainingSec <= 0
          ? 'bg-red-50 border-red-200 text-red-900'
          : isUrgent
          ? 'bg-red-50 border-red-200 text-red-950'
          : 'bg-amber-50 border-amber-200 text-amber-950'
      }`}
    >
      <Clock
        className={`w-4 h-4 shrink-0 mt-0.5 ${
          remainingSec <= 0 || isUrgent ? 'text-red-700' : 'text-amber-700'
        }`}
      />
      <div className="space-y-0.5">
        <div className="font-bold">
          {remainingSec <= 0 ? (
            'Prazo de 1 hora para pagamento encerrado!'
          ) : (
            <>
              Produtos reservados no estoque para você! Tempo restante para pagamento:{' '}
              <span className="font-mono text-sm underline">{formattedTime}</span>
            </>
          )}
        </div>
        <div className="opacity-90">
          {remainingSec <= 0
            ? 'Como o pagamento não foi confirmado em 1 hora, o pedido é cancelado automaticamente e os produtos retornam para a vitrine.'
            : 'Realize o pagamento via PIX e envie o comprovante no WhatsApp dentro de 1 hora. Caso não seja pago nesse prazo, o pedido é cancelado e o saldo volta automaticamente para a vitrine.'}
        </div>
      </div>
    </div>
  );
};
