import React, { useState, useEffect, useCallback } from 'react';
import { Lock, Eye, EyeOff, KeyRound, Database, Download, Upload, Server, CheckCircle2 } from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';

interface SettingsFormState {
  whatsapp_number: string;
  pix_key: string;
  pix_instructions: string;
  freight_base_km: string;
  freight_base_fee: string;
  freight_extra_km_fee: string;
  store_origin_address: string;
  payment_deadline_hours: string;
  cpf_strict_validation_enabled: string;
  store_timezone: string;
  packaging_cost_per_order: string;
  delivery_cost_per_order: string;
  monthly_fixed_costs: string;
  store_status: string;
  store_closed_message: string;
  accept_orders_when_closed: string;
  store_hours: string;
  company_name: string;
  company_cnpj: string;
  company_address: string;
  company_email: string;
  company_phone: string;
  privacy_content: string;
  terms_content: string;
  exchange_content: string;
  callmebot_enabled: string;
  callmebot_last_sent_at: string;
}

interface AdminSettingsSectionProps {
  settingsForm: SettingsFormState;
  setSettingsForm: React.Dispatch<React.SetStateAction<SettingsFormState>>;
  handleSaveSettings: (e: React.FormEvent) => void;
}

interface DbStatusInfo {
  engine: {
    mode: string;
    host: string;
    migrationFile: string;
  };
  snapshotUpdatedAt: string | null;
  counts: {
    products: number;
    categories: number;
    kits: number;
    mediaFiles: number;
    customers: number;
    orders: number;
  };
}

export const AdminSettingsSection: React.FC<AdminSettingsSectionProps> = ({
  settingsForm,
  setSettingsForm,
  handleSaveSettings,
}) => {
  const { user, token, apiFetch, refreshUser, toast } = useApp();

  const [adminName, setAdminName] = useState(user?.name || 'Administrador');
  const [adminEmail, setAdminEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);

  // Estado do Banco PostgreSQL & Migração VPS
  const [dbStatus, setDbStatus] = useState<DbStatusInfo | null>(null);
  const [downloadingSql, setDownloadingSql] = useState(false);
  const [downloadingJson, setDownloadingJson] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);

  // Disparo de Notificações / Promoção estilo iFood
  const [broadcastTitle, setBroadcastTitle] = useState('🔥 Novidades fresquinhas na loja!');
  const [broadcastMessage, setBroadcastMessage] = useState(
    'Chegaram novidades imperdíveis com pronta entrega em Itatiba! Peça agora e receba em poucas horas.'
  );
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [testingCallMeBot, setTestingCallMeBot] = useState(false);
  const [callMeBotConfigured, setCallMeBotConfigured] = useState(false);

  const handleTestCallMeBot = async () => {
    setTestingCallMeBot(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/admin/callmebot/test', { method: 'POST' });
      toast(res.message || 'Teste enviado.', 'success');
      setSettingsForm((prev) => ({ ...prev, callmebot_last_sent_at: new Date().toISOString() }));
    } catch (err: any) {
      toast(err.message || 'Não foi possível enviar o teste.', 'error');
    } finally {
      setTestingCallMeBot(false);
    }
  };

  useEffect(() => {
    apiFetch<{ configured: boolean }>('/api/admin/callmebot/status')
      .then((res) => setCallMeBotConfigured(Boolean(res.configured)))
      .catch(() => setCallMeBotConfigured(false));
  }, [apiFetch]);

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastMessage.trim()) {
      toast('Preencha o título e a mensagem para o disparo.', 'error');
      return;
    }
    setSendingBroadcast(true);
    try {
      const res = await apiFetch<{ message: string; count: number }>(
        '/api/admin/broadcast-notification',
        {
          method: 'POST',
          body: JSON.stringify({
            title: broadcastTitle.trim(),
            message: broadcastMessage.trim(),
          }),
        }
      );
      toast(res.message || 'Notificação disparada com sucesso!', 'success');
    } catch (err: any) {
      toast(err.message || 'Erro ao disparar notificação.', 'error');
    } finally {
      setSendingBroadcast(false);
    }
  };

  const loadDbStatus = useCallback(async () => {
    try {
      const res = await apiFetch<DbStatusInfo>('/api/admin/database/status');
      setDbStatus(res);
    } catch {
      // ignore
    }
  }, [apiFetch]);

  useEffect(() => {
    loadDbStatus();
  }, [loadDbStatus]);

  useEffect(() => {
    if (user) {
      setAdminName(user.name || 'Administrador');
      setAdminEmail(user.email || '');
    }
  }, [user]);

  const handleDownloadSqlDump = async () => {
    setDownloadingSql(true);
    try {
      const res = await fetch('/api/admin/database/export-sql', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Falha ao exportar dump SQL.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `achadinhos-postgresql-vps-${new Date().toISOString().slice(0, 10)}.sql`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Dump PostgreSQL (.sql) baixado com sucesso! Pronto para importar na VPS.', 'success');
      loadDbStatus();
    } catch (err: any) {
      toast(err.message || 'Erro ao baixar dump SQL.', 'error');
    } finally {
      setDownloadingSql(false);
    }
  };

  const handleDownloadJsonBackup = async () => {
    setDownloadingJson(true);
    try {
      const res = await fetch('/api/admin/database/export-json', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Falha ao exportar backup JSON.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `achadinhos-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Backup completo (.json) baixado com sucesso!', 'success');
      loadDbStatus();
    } catch (err: any) {
      toast(err.message || 'Erro ao baixar backup JSON.', 'error');
    } finally {
      setDownloadingJson(false);
    }
  };

  const handleRestoreJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoringBackup(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await apiFetch<{ message: string }>('/api/admin/database/restore-json', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      toast(res.message || 'Backup restaurado com sucesso!', 'success');
      await loadDbStatus();
    } catch (err: any) {
      toast(err.message || 'Erro ao restaurar arquivo de backup.', 'error');
    } finally {
      setRestoringBackup(false);
      e.target.value = '';
    }
  };

  const handleUpdateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword.trim()) {
      toast('Digite sua senha atual para confirmar a alteração.', 'error');
      return;
    }
    if (newPassword.trim() && newPassword.trim().length < 10) {
      toast('A nova senha do administrador deve ter no mínimo 10 caracteres.', 'error');
      return;
    }
    if (newPassword.trim() && newPassword.trim() !== confirmNewPassword.trim()) {
      toast('A confirmação da nova senha não confere.', 'error');
      return;
    }

    setSavingCredentials(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/admin/credentials', {
        method: 'PUT',
        body: JSON.stringify({
          name: adminName,
          email: adminEmail,
          currentPassword,
          newPassword: newPassword.trim() || undefined,
        }),
      });
      toast(res.message || 'Credenciais atualizadas com sucesso!', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      await refreshUser();
    } catch (err: any) {
      toast(err.message || 'Erro ao atualizar credenciais.', 'error');
    } finally {
      setSavingCredentials(false);
    }
  };

  return (
    <div className="max-w-[760px] space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Configurações da Loja</h1>
        <p className="text-xs text-zinc-500">
          Defina o WhatsApp oficial de recebimento de pedidos, chave Pix, parâmetros de frete e
          gerencie seu banco de dados PostgreSQL e migração para VPS.
        </p>
      </div>

      {/* 5. BANCO DE DADOS POSTGRESQL (PRODUÇÃO, MIGRAÇÕES & EXPORTAÇÃO PARA VPS) */}
      <div className="bg-white border-2 border-[#087BFF]/35 rounded-xl p-6 space-y-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-sky-100 border border-sky-200 flex items-center justify-center text-[#087BFF]">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-zinc-900">
                  Banco de Dados PostgreSQL (Produção & Migração para VPS)
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-100 text-[#0666D6] text-[10px] font-bold">
                  <CheckCircle2 className="w-3 h-3" />
                  PostgreSQL Ativo + Auto-Snapshot
                </span>
              </div>
              <p className="text-[11px] text-zinc-600">
                Todos os produtos, fotos, categorias, clientes e pedidos que você cadastrar ficam
                salvos em PostgreSQL com migração oficial pronta para qualquer VPS.
              </p>
            </div>
          </div>
        </div>

        {/* Contadores em tempo real do banco PostgreSQL */}
        {dbStatus && (
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
            <div className="p-2.5 rounded-lg bg-sky-50/70 border border-sky-200 text-center">
              <div className="text-base font-extrabold text-[#0666D6] tabular-nums">
                {dbStatus.counts.products}
              </div>
              <div className="text-[10px] font-bold text-zinc-600 uppercase">Produtos</div>
            </div>
            <div className="p-2.5 rounded-lg bg-sky-50/70 border border-sky-200 text-center">
              <div className="text-base font-extrabold text-[#0666D6] tabular-nums">
                {dbStatus.counts.categories}
              </div>
              <div className="text-[10px] font-bold text-zinc-600 uppercase">Categorias</div>
            </div>
            <div className="p-2.5 rounded-lg bg-sky-50/70 border border-sky-200 text-center">
              <div className="text-base font-extrabold text-[#0666D6] tabular-nums">
                {dbStatus.counts.kits}
              </div>
              <div className="text-[10px] font-bold text-zinc-600 uppercase">Kits</div>
            </div>
            <div className="p-2.5 rounded-lg bg-sky-50/70 border border-sky-200 text-center">
              <div className="text-base font-extrabold text-[#0666D6] tabular-nums">
                {dbStatus.counts.mediaFiles}
              </div>
              <div className="text-[10px] font-bold text-zinc-600 uppercase">Fotos/Vídeos</div>
            </div>
            <div className="p-2.5 rounded-lg bg-sky-50/70 border border-sky-200 text-center">
              <div className="text-base font-extrabold text-[#0666D6] tabular-nums">
                {dbStatus.counts.customers}
              </div>
              <div className="text-[10px] font-bold text-zinc-600 uppercase">Clientes</div>
            </div>
            <div className="p-2.5 rounded-lg bg-sky-50/70 border border-sky-200 text-center">
              <div className="text-base font-extrabold text-[#0666D6] tabular-nums">
                {dbStatus.counts.orders}
              </div>
              <div className="text-[10px] font-bold text-zinc-600 uppercase">Pedidos</div>
            </div>
          </div>
        )}

        {/* Botões de Exportação SQL para VPS e Backup/Restauração */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleDownloadSqlDump}
            disabled={downloadingSql}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#087BFF] hover:bg-[#0666D6] text-white text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>
              {downloadingSql
                ? 'Gerando Dump SQL...'
                : 'Baixar Dump PostgreSQL (.sql) para VPS'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleDownloadJsonBackup}
            disabled={downloadingJson}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#09090B] hover:bg-zinc-800 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4 shrink-0 text-[#C084FC]" />
            <span>
              {downloadingJson ? 'Gerando Backup...' : 'Baixar Backup Completo (.json)'}
            </span>
          </button>

          <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-300 text-zinc-900 text-xs font-bold transition-colors cursor-pointer">
            <Upload className="w-4 h-4 shrink-0 text-[#087BFF]" />
            <span>{restoringBackup ? 'Restaurando...' : 'Restaurar Backup (.json)'}</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleRestoreJsonFile}
              disabled={restoringBackup}
              className="hidden"
            />
          </label>
        </div>

        {/* Guia prático de migração para VPS com PostgreSQL */}
        <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-2 text-xs text-zinc-700">
          <div className="flex items-center gap-1.5 font-bold text-zinc-900">
            <Server className="w-4 h-4 text-[#087BFF]" />
            <span>Como migrar para sua VPS com PostgreSQL instalado quando quiser:</span>
          </div>
          <ol className="list-decimal list-inside space-y-1 text-[11px] text-zinc-600 leading-relaxed">
            <li>
              Clique no botão azul <strong>&ldquo;Baixar Dump PostgreSQL (.sql) para VPS&rdquo;</strong> acima (ele já inclui a migração de todas as 13 tabelas + todos os seus produtos, fotos, clientes e pedidos cadastrados).
            </li>
            <li>
              Na sua VPS com PostgreSQL instalado, crie o banco e importe o arquivo:
              <pre className="mt-1 p-2 rounded bg-zinc-900 text-sky-200 font-mono text-[11px] overflow-x-auto">
{`createdb -U postgres achadinhos
psql -U postgres -d achadinhos -f achadinhos-postgresql-vps.sql`}
              </pre>
            </li>
            <li>
              No arquivo <code className="font-mono bg-stone-200 px-1 rounded">.env</code> da VPS, defina <code className="font-mono bg-stone-200 px-1 rounded">PGHOST=localhost</code>, <code className="font-mono bg-stone-200 px-1 rounded">PGPORT=5432</code>, <code className="font-mono bg-stone-200 px-1 rounded">PGUSER=postgres</code>, <code className="font-mono bg-stone-200 px-1 rounded">PGPASSWORD=sua_senha</code> e <code className="font-mono bg-stone-200 px-1 rounded">PGDATABASE=achadinhos</code> — o servidor detecta e usa o PostgreSQL da VPS automaticamente!
            </li>
          </ol>
        </div>
      </div>

      {/* DISPARO DE NOTIFICAÇÕES & PROMOÇÕES PARA CLIENTES (ESTILO IFOOD) */}
      <form
        onSubmit={handleSendBroadcast}
        className="bg-white border-2 border-sky-200 rounded-xl p-6 space-y-4 shadow-xs"
      >
        <div className="flex items-center gap-2.5 border-b border-stone-200 pb-3">
          <div className="w-9 h-9 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700">
            <span className="text-lg">📢</span>
          </div>
          <div>
            <h2 className="text-sm font-bold text-zinc-900">
              Disparar Notificação / Promoção no Celular dos Clientes (Estilo iFood)
            </h2>
            <p className="text-[11px] text-zinc-600">
              Envie um alerta instantâneo com som e vibração para todos os clientes cadastrados (novidades no estoque, promoções relâmpago, cupons).
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="block text-xs font-bold text-zinc-700">
              Título da Notificação
            </label>
            <input
              type="text"
              required
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              placeholder="Ex: 🔥 Novidades fresquinhas na loja!"
              className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#087BFF]"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-bold text-zinc-700">
              Mensagem da Notificação
            </label>
            <textarea
              rows={2}
              required
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              placeholder="Ex: Acabaram de chegar novos produtos com pronta entrega em Itatiba! Peça agora e receba em poucas horas."
              className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#087BFF]"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-zinc-500">
              A notificação aparece na barra de status do celular de quem tem o app instalado ou abriu o navegador.
            </p>

            <button
              type="submit"
              disabled={sendingBroadcast}
              className="px-5 py-2.5 text-xs font-bold text-white bg-[#087BFF] hover:bg-[#0666D6] rounded-xl transition-colors shadow-xs cursor-pointer disabled:opacity-50 shrink-0"
            >
              {sendingBroadcast ? 'Disparando...' : 'Disparar para Clientes 🚀'}
            </button>
          </div>
        </div>
      </form>

      <form
        onSubmit={handleSaveSettings}
        className="bg-white border border-stone-200 rounded-xl p-6 space-y-6"
      >
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-zinc-900 border-b border-stone-200 pb-2">
            1. Atendimento WhatsApp & Pagamento Pix
          </h2>

          {!String(settingsForm.whatsapp_number || '').replace(/\D/g, '') && (
            <div
              role="alert"
              className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2"
            >
              Configure o WhatsApp da loja. Sem o número, os clientes não conseguem enviar pedidos pelo
              WhatsApp.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">
                Número do WhatsApp da Loja (com DDI 55 + DDD)
              </label>
              <input
                type="text"
                required
                value={settingsForm.whatsapp_number}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, whatsapp_number: e.target.value })
                }
                placeholder="55 + DDD + número"
                className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">
                Prazo de Reserva / Pagamento em Horas (Padrão: 1h)
              </label>
              <input
                type="number"
                min="1"
                required
                value={settingsForm.payment_deadline_hours}
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    payment_deadline_hours: e.target.value,
                  })
                }
                className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono"
              />
              <p className="text-[11px] text-zinc-500">
                Após esse prazo sem confirmação de pagamento, o pedido é cancelado automaticamente e o saldo volta ao estoque.
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-zinc-700">Chave Pix</label>
            <input
              type="text"
              value={settingsForm.pix_key}
              onChange={(e) => setSettingsForm({ ...settingsForm, pix_key: e.target.value })}
              placeholder="CNPJ, E-mail, Telefone ou Chave Aleatória"
              className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-zinc-700">
              Instruções de Pagamento Pix
            </label>
            <textarea
              rows={2}
              value={settingsForm.pix_instructions}
              onChange={(e) =>
                setSettingsForm({ ...settingsForm, pix_instructions: e.target.value })
              }
              className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-bold text-zinc-900 border-b border-stone-200 pb-2">
            2. Parâmetros da Sugestão Aritmética de Frete (Seção 10.2)
          </h2>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-zinc-700">
              Endereço de Origem Padrão da Loja
            </label>
            <input
              type="text"
              value={settingsForm.store_origin_address}
              onChange={(e) =>
                setSettingsForm({
                  ...settingsForm,
                  store_origin_address: e.target.value,
                })
              }
              className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">
                Distância Base (km)
              </label>
              <input
                type="number"
                step="0.1"
                required
                value={settingsForm.freight_base_km}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, freight_base_km: e.target.value })
                }
                className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">
                Valor até Distância Base (R$)
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={settingsForm.freight_base_fee}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, freight_base_fee: e.target.value })
                }
                className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">
                Adicional por km Extra (R$)
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={settingsForm.freight_extra_km_fee}
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    freight_extra_km_fee: e.target.value,
                  })
                }
                className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono"
              />
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-stone-50 border border-stone-200 text-xs text-zinc-600 space-y-1">
            <div className="font-semibold text-zinc-900">
              Exemplos de verificação (Teste 4 — Regra padrão 4 km = R$ 7,50 + R$ 1,50/km
              proporcional):
            </div>
            <div className="font-mono">
              3,1 km = R$ 7,50 · 4,0 km = R$ 7,50 · 6,5 km = R$ 11,25 · 10,4 km = R$ 17,10
            </div>
          </div>
        </div>

        {/* 3. Validação de CPF Real (Inativo no Teste / Ativo em Produção - Requisito 1) */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-zinc-900 border-b border-stone-200 pb-2">
            3. Validação de CPF Real no Criar Conta (Modo Teste vs. Produção)
          </h2>

          <div className="p-4 rounded-xl border border-stone-200 bg-stone-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-900">
                  Exigir CPF Real Matematicamente Válido no Cadastro
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    settingsForm.cpf_strict_validation_enabled === 'true'
                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      : 'bg-amber-100 text-amber-900 border border-amber-300'
                  }`}
                >
                  {settingsForm.cpf_strict_validation_enabled === 'true'
                    ? 'Ativo (Produção)'
                    : 'Inativo (Modo de Teste)'}
                </span>
              </div>
              <p className="text-xs text-zinc-600 leading-relaxed">
                Quando <strong>Inativo (Modo de Teste)</strong>, o sistema aceita qualquer CPF de 11
                dígitos para facilitar seus testes (mas continua bloqueando CPF repetido/já
                cadastrado). Quando for colocar em <strong>Produção</strong>, ative esta opção para
                exigir apenas CPFs reais verdadeiros.
              </p>
            </div>

            <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={settingsForm.cpf_strict_validation_enabled === 'true'}
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    cpf_strict_validation_enabled: e.target.checked ? 'true' : 'false',
                  })
                }
                className="w-4 h-4 rounded border-stone-300 text-zinc-900 focus:ring-zinc-900"
              />
              <span className="text-xs font-semibold text-zinc-900">
                {settingsForm.cpf_strict_validation_enabled === 'true'
                  ? 'Ativado para Produção'
                  : 'Ativar para Produção'}
              </span>
            </label>
          </div>
        </div>

        {/* 3. Loja Aberta/Fechada */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-zinc-900 border-b border-stone-200 pb-2">3. Status e Horário da Loja</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">Status manual da loja</label>
              <select value={settingsForm.store_status} onChange={(e) => setSettingsForm({ ...settingsForm, store_status: e.target.value })} className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg">
                <option value="OPEN">Aberta</option>
                <option value="CLOSED">Fechada</option>
              </select>
            </div>
            <label className="flex items-center gap-2 pt-5 text-xs font-semibold text-zinc-800">
              <input type="checkbox" checked={settingsForm.accept_orders_when_closed === 'true'} onChange={(e) => setSettingsForm({ ...settingsForm, accept_orders_when_closed: e.target.checked ? 'true' : 'false' })} className="w-4 h-4 rounded border-stone-300" />
              Aceitar pedidos fora do horário enquanto a loja estiver marcada como aberta
            </label>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-zinc-700">Mensagem quando fechada</label>
            <input type="text" value={settingsForm.store_closed_message} onChange={(e) => setSettingsForm({ ...settingsForm, store_closed_message: e.target.value })} className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg" />
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold text-zinc-700">Horários por dia</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-zinc-500"><th className="py-1">Dia</th><th>Ativo</th><th>Abertura</th><th>Fechamento</th></tr></thead>
                <tbody>
                  {([['mon','Segunda'],['tue','Terça'],['wed','Quarta'],['thu','Quinta'],['fri','Sexta'],['sat','Sábado'],['sun','Domingo']] as const).map(([key,label]) => {
                    let hours: any = {};
                    try { hours = JSON.parse(settingsForm.store_hours || '{}'); } catch {}
                    const day = hours[key] || { enabled: false, open: '09:00', close: '18:00' };
                    const updateDay = (patch: any) => setSettingsForm(prev => { let parsed: any = {}; try { parsed = JSON.parse(prev.store_hours || '{}'); } catch {} return { ...prev, store_hours: JSON.stringify({ ...parsed, [key]: { ...day, ...patch } }) }; });
                    return <tr key={key} className="border-t border-stone-100"><td className="py-2 font-medium">{label}</td><td><input type="checkbox" checked={Boolean(day.enabled)} onChange={(e) => updateDay({ enabled: e.target.checked })} /></td><td><input type="time" value={day.open} onChange={(e) => updateDay({ open: e.target.value })} className="px-2 py-1 border border-stone-300 rounded" /></td><td><input type="time" value={day.close} onChange={(e) => updateDay({ close: e.target.value })} className="px-2 py-1 border border-stone-300 rounded" /></td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 4. Fuso Horário & Custos Operacionais (Itens 1 e 4) */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-zinc-900 border-b border-stone-200 pb-2">
            4. Fuso Horário & Custos Operacionais (Cálculo Preciso de Lucro)
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">
                Fuso Horário da Loja
              </label>
              <select
                value={settingsForm.store_timezone || 'America/Sao_Paulo'}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, store_timezone: e.target.value })
                }
                className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono"
              >
                <option value="America/Sao_Paulo">America/Sao_Paulo (Brasília, UTC-3)</option>
                <option value="America/Manaus">America/Manaus (UTC-4)</option>
                <option value="America/Belem">America/Belem (UTC-3)</option>
                <option value="America/Fortaleza">America/Fortaleza (UTC-3)</option>
                <option value="America/Recife">America/Recife (UTC-3)</option>
                <option value="America/Cuiaba">America/Cuiaba (UTC-4)</option>
                <option value="America/Rio_Branco">America/Rio_Branco (UTC-5)</option>
              </select>
              <p className="text-[11px] text-zinc-500">
                Garante que vendas feitas entre 21h e 23h59 entrem na data de hoje e não no dia seguinte.
              </p>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">
                Custo de Embalagem por Pedido (R$)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={settingsForm.packaging_cost_per_order || '0.00'}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, packaging_cost_per_order: e.target.value })
                }
                placeholder="Ex: 1.00 (sacola, caixa, fita)"
                className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono"
              />
              <p className="text-[11px] text-zinc-500">
                Valor médio gasto com pacote/sacola em cada pedido entregue.
              </p>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">
                Custo Médio de Entrega por Pedido (R$)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={settingsForm.delivery_cost_per_order || '0.00'}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, delivery_cost_per_order: e.target.value })
                }
                placeholder="Ex: 4.00 (valor pago ao motoboy)"
                className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono"
              />
              <p className="text-[11px] text-zinc-500">
                Custo real do motoboy/frete da entrega por pedido (usado também para calcular o custo do programa de entrega grátis).
              </p>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700">
                Custos Fixos do Mês (R$)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={settingsForm.monthly_fixed_costs || '0.00'}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, monthly_fixed_costs: e.target.value })
                }
                placeholder="Ex: 82.05 (DAS/MEI, contador, etc.)"
                className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono"
              />
              <p className="text-[11px] text-zinc-500">
                Subtraído apenas no fechamento do resultado do mês (não afeta o lucro do dia).
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-bold text-zinc-900 border-b border-stone-200 pb-2">5. Dados da Empresa, LGPD e Notificações</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([['company_name','Nome da empresa'],['company_cnpj','CNPJ'],['company_address','Endereço da empresa'],['company_email','E-mail da empresa'],['company_phone','Telefone da empresa']] as const).map(([key,label]) => (
              <div key={key} className="space-y-1"><label className="block text-xs font-semibold text-zinc-700">{label}</label><input value={(settingsForm as any)[key] || ''} onChange={(e) => setSettingsForm({ ...settingsForm, [key]: e.target.value })} className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg" /></div>
            ))}
          </div>
          {([['privacy_content','Texto da Política de Privacidade'],['terms_content','Texto dos Termos de Uso'],['exchange_content','Texto de Trocas e Devoluções']] as const).map(([key,label]) => (
            <div key={key} className="space-y-1"><label className="block text-xs font-semibold text-zinc-700">{label}</label><textarea rows={4} value={(settingsForm as any)[key] || ''} onChange={(e) => setSettingsForm({ ...settingsForm, [key]: e.target.value })} className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg" /></div>
          ))}
          <div className="p-4 rounded-xl bg-sky-50 border border-sky-200 space-y-3">
            <div className="flex items-center justify-between gap-3"><div><div className="text-xs font-bold text-sky-900">Aviso de novo pedido via CallMeBot</div><div className="text-[11px] text-sky-800">Configure CALLMEBOT_PHONE e CALLMEBOT_APIKEY no ambiente da aplicação.</div></div><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={settingsForm.callmebot_enabled === 'true'} onChange={(e) => setSettingsForm({ ...settingsForm, callmebot_enabled: e.target.checked ? 'true' : 'false' })} /> Ativo</label></div>
            <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={handleTestCallMeBot} disabled={testingCallMeBot || !callMeBotConfigured || settingsForm.callmebot_enabled !== 'true'} className="px-3 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg disabled:opacity-50">{testingCallMeBot ? 'Enviando...' : 'Enviar mensagem de teste'}</button><span className="text-[11px] text-sky-900">{callMeBotConfigured ? 'Credenciais detectadas.' : 'Credenciais não detectadas no ambiente.'}{settingsForm.callmebot_last_sent_at ? ` Último envio: ${new Date(settingsForm.callmebot_last_sent_at).toLocaleString('pt-BR')}` : ''}</span></div>
          </div>
        </div>

        <button
          type="submit"
          className="px-5 py-2.5 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
        >
          Salvar Configurações da Loja
        </button>
      </form>

      {/* 4. Alterar E-mail e Senha do Administrador (Item 3.4) */}
      <form
        onSubmit={handleUpdateCredentials}
        className="bg-white border border-stone-200 rounded-xl p-6 space-y-5"
      >
        <div className="flex items-center justify-between border-b border-stone-200 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-stone-100 border border-stone-200 flex items-center justify-center text-zinc-800">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900">
                4. Segurança & Acesso do Administrador (E-mail e Senha)
              </h2>
              <p className="text-[11px] text-zinc-500">
                Altere seu e-mail de acesso ou troque sua senha de administrador quando quiser.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowPasswords((prev) => !prev)}
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 cursor-pointer"
          >
            {showPasswords ? (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                <span>Ocultar senhas</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" />
                <span>Mostrar senhas</span>
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-zinc-700">
              Nome do Administrador
            </label>
            <input
              type="text"
              required
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-zinc-700">
              E-mail de Login do Admin
            </label>
            <input
              type="email"
              required
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-zinc-700">
              Senha Atual (Obrigatória) *
            </label>
            <div className="relative">
              <input
                type={showPasswords ? 'text' : 'password'}
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Sua senha atual"
                className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-zinc-700">
              Nova Senha (Opcional)
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-zinc-700">
              Confirmar Nova Senha
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              placeholder="Repita a nova senha"
              className="w-full px-3.5 py-2 text-sm bg-white border border-stone-300 rounded-lg"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-[11px] text-zinc-500 flex items-center gap-1">
            <Lock className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span>
              Se quiser alterar apenas o e-mail ou nome, deixe os campos de &ldquo;Nova Senha&rdquo; em branco.
            </span>
          </p>

          <button
            type="submit"
            disabled={savingCredentials}
            className="px-5 py-2.5 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors shrink-0 cursor-pointer disabled:opacity-50"
          >
            {savingCredentials ? 'Atualizando...' : 'Atualizar E-mail / Senha'}
          </button>
        </div>
      </form>
    </div>
  );
};
