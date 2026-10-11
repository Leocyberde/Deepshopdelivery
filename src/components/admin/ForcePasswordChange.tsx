import React, { useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';

// Exibida quando o admin ainda usa a senha provisória/antiga (must_change_password = true).
export const ForcePasswordChange: React.FC = () => {
  const { user, apiFetch, toast, refreshUser, logout } = useApp();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 10) {
      toast('A nova senha deve ter no mínimo 10 caracteres.', 'error');
      return;
    }
    if (newPassword !== confirm) {
      toast('A confirmação da nova senha não confere.', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/admin/credentials', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      toast('Senha atualizada. Painel liberado.', 'success');
      await refreshUser();
    } catch (err: any) {
      toast(err.message || 'Erro ao trocar a senha.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const input =
    'w-full px-3.5 py-2.5 text-sm bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900';

  return (
    <main className="max-w-[460px] mx-auto px-4 py-16 space-y-4">
      <h1 className="text-xl font-bold text-zinc-900">Troque a senha para continuar</h1>
      <p className="text-sm text-zinc-600">
        {user?.email}: esta conta usa uma senha provisória. Defina uma nova senha (mínimo de 10
        caracteres) para liberar o painel.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <input type="password" required placeholder="Senha atual" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={input} />
        <input type="password" required minLength={10} placeholder="Nova senha" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={input} />
        <input type="password" required minLength={10} placeholder="Confirmar nova senha" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
        <button type="submit" disabled={saving} className="w-full py-2.5 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg disabled:opacity-50">
          {saving ? 'Salvando...' : 'Salvar nova senha'}
        </button>
        <button type="button" onClick={logout} className="w-full py-2 text-xs text-zinc-600 underline">
          Sair
        </button>
      </form>
    </main>
  );
};
