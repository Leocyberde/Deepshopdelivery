import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Store,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  MapPin,
  Truck,
} from 'lucide-react';
import {
  useApp,
  isAdminRole,
  formatCpfMask,
  normalizeCpfDigits,
  isValidBrazilianCpf,
  formatCepMask,
  lookupCepAddress,
  isItatibaCity,
} from '../context/AppContext.tsx';

type AuthMode = 'LOGIN' | 'REGISTER' | 'RECOVER';

function safeInternalRedirect(value: string | null): string {
  const path = value?.trim() || '';
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '';
  try {
    const parsed = new URL(path, window.location.origin);
    if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith('/')) return '';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '';
  }
}

export const AuthPage: React.FC = () => {
  const { apiFetch, loginWithToken, toast } = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectPath = safeInternalRedirect(searchParams.get('redirect'));

  const [mode, setMode] = useState<AuthMode>('LOGIN');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register fields
  const [regName, setRegName] = useState('');
  const [regCpf, setRegCpf] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [lgpdAccepted, setLgpdAccepted] = useState(false);

  // Register CPF validation & duplicate check states
  const [cpfStrictValidationEnabled, setCpfStrictValidationEnabled] = useState(false);
  const [cpfChecking, setCpfChecking] = useState(false);
  const [cpfDuplicateExists, setCpfDuplicateExists] = useState(false);

  // Register Address fields
  const [regAddrLabel, setRegAddrLabel] = useState('Casa');
  const [regZipCode, setRegZipCode] = useState('');
  const [regStreet, setRegStreet] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const [regComplement, setRegComplement] = useState('');
  const [regNeighborhood, setRegNeighborhood] = useState('');
  const [regCity, setRegCity] = useState('Itatiba');
  const [regState, setRegState] = useState('SP');
  const [regReference, setRegReference] = useState('');
  const [regCepLoading, setRegCepLoading] = useState(false);
  const [regCepFeedback, setRegCepFeedback] = useState<string | null>(null);

  // Recover password fields
  const [recEmail, setRecEmail] = useState('');
  const [recCode, setRecCode] = useState('');
  const [recNewPassword, setRecNewPassword] = useState('');

  useEffect(() => {
    let active = true;
    apiFetch('/api/auth/register-config')
      .then((res) => {
        if (active && res) {
          setCpfStrictValidationEnabled(Boolean(res.cpfStrictValidationEnabled));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const digits = normalizeCpfDigits(regCpf);
    if (digits.length !== 11) {
      setCpfDuplicateExists(false);
      setCpfChecking(false);
      return;
    }
    let active = true;
    setCpfChecking(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/auth/check-cpf/${digits}`);
        if (!active) return;
        setCpfDuplicateExists(Boolean(res.exists));
        if (res.cpfStrictValidationEnabled !== undefined) {
          setCpfStrictValidationEnabled(Boolean(res.cpfStrictValidationEnabled));
        }
      } catch {
        // ignore network error during live check
      } finally {
        if (active) setCpfChecking(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [regCpf]);

  const handleRegCepChange = async (rawValue: string) => {
    const formatted = formatCepMask(rawValue);
    setRegZipCode(formatted);
    const digits = formatted.replace(/\D/g, '');
    if (digits.length === 8) {
      setRegCepLoading(true);
      setRegCepFeedback('Buscando endereço pelo CEP...');
      const found = await lookupCepAddress(digits);
      setRegCepLoading(false);
      if (found) {
        if (found.street) setRegStreet(found.street);
        if (found.neighborhood) setRegNeighborhood(found.neighborhood);
        if (found.city) setRegCity(found.city);
        if (found.state) setRegState(found.state);
        const cityCheckMsg = isItatibaCity(found.city)
          ? 'Cidade: Itatiba — Temos delivery! Informe o número da residência.'
          : `Cidade: ${found.city}/${found.state} — Entrega através dos Correios (conferir valor no WhatsApp).`;
        setRegCepFeedback(`Endereço preenchido automaticamente! ${cityCheckMsg}`);
      } else {
        setRegCepFeedback('CEP não encontrado automaticamente. Preencha os campos manualmente.');
      }
    } else {
      setRegCepFeedback(null);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      loginWithToken(res.token, res.user);
      toast(`Bem-vindo(a), ${res.user.name}!`, 'success');
      if (redirectPath) {
        navigate(redirectPath);
      } else if (isAdminRole(res.user.role)) {
        navigate('/admin');
      } else {
        navigate('/minha-conta');
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanCpf = normalizeCpfDigits(regCpf);
    if (cleanCpf.length !== 11) {
      setErrorMsg('Por favor, informe os 11 números do seu CPF.');
      return;
    }
    if (cpfStrictValidationEnabled && !isValidBrazilianCpf(cleanCpf)) {
      setErrorMsg('CPF inválido. Por favor, informe um CPF verdadeiro válido.');
      return;
    }
    if (cpfDuplicateExists) {
      setErrorMsg('Este CPF já está cadastrado em outra conta.');
      return;
    }
    if (
      !regZipCode.trim() ||
      !regStreet.trim() ||
      !regNumber.trim() ||
      !regNeighborhood.trim() ||
      !regCity.trim() ||
      !regState.trim()
    ) {
      setErrorMsg('Preencha o endereço completo de entrega (CEP, rua, número, bairro, cidade e UF).');
      return;
    }
    if (!lgpdAccepted) {
      setErrorMsg('Por favor, leia e aceite o aviso de privacidade (LGPD) para continuar.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: regName,
          cpf: regCpf,
          email: regEmail,
          phone: regPhone,
          password: regPassword,
          lgpdAccepted,
          address: {
            label: regAddrLabel || 'Casa',
            zipCode: regZipCode,
            street: regStreet,
            number: regNumber,
            complement: regComplement,
            neighborhood: regNeighborhood,
            city: regCity,
            state: regState,
            reference: regReference,
          },
        }),
      });
      loginWithToken(res.token, res.user);
      toast('Conta criada com sucesso!', 'success');
      navigate(redirectPath || '/minha-conta');
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          email: recEmail,
          code: recCode,
          newPassword: recNewPassword,
        }),
      });
      toast(res.message, 'success');
      setLoginEmail(recEmail);
      setLoginPassword('');
      setMode('LOGIN');
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const regCpfDigits = normalizeCpfDigits(regCpf);
  const regCpfIsRealValid = regCpfDigits.length === 11 && isValidBrazilianCpf(regCpfDigits);

  return (
    <main className="max-w-[600px] mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 bg-white border border-stone-200 hover:bg-stone-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Voltar à tela anterior</span>
        </button>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 bg-white border border-stone-200 hover:bg-stone-100 rounded-lg transition-colors"
        >
          <Store className="w-3.5 h-3.5" />
          <span>Ir para a Vitrine</span>
        </Link>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold text-zinc-900">
            {mode === 'LOGIN'
              ? 'Acesse sua conta'
              : mode === 'REGISTER'
              ? 'Criar conta no DeepShop Delivery'
              : 'Recuperar senha'}
          </h1>
          <p className="text-xs text-zinc-500">
            {mode === 'LOGIN'
              ? 'Entre como cliente para acompanhar pedidos ou como administrador da loja.'
              : mode === 'REGISTER'
              ? 'Cadastre seu CPF e endereço para cálculo do seu frete e entregas rápidas.'
              : 'Confirme seu e-mail e o telefone cadastrado na conta para definir uma nova senha.'}
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-lg">
          <button
            type="button"
            onClick={() => {
              setMode('LOGIN');
              setErrorMsg(null);
            }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'LOGIN'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('REGISTER');
              setErrorMsg(null);
            }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'REGISTER'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Criar Conta
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('RECOVER');
              setErrorMsg(null);
            }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'RECOVER'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Recuperar Senha
          </button>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800">
            {errorMsg}
          </div>
        )}

        {mode === 'LOGIN' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-zinc-800">E-mail</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-zinc-800">Senha</label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
            >
              {submitting ? 'Autenticando...' : 'Entrar na Conta'}
            </button>
          </form>
        )}

        {mode === 'REGISTER' && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-zinc-800">Nome completo</label>
                <input
                  type="text"
                  required
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="Ex: Maria Oliveira"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-1">
                  <label className="block text-xs font-semibold text-zinc-800">CPF</label>
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      cpfStrictValidationEnabled
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    <ShieldCheck className="w-3 h-3" />
                    {cpfStrictValidationEnabled
                      ? 'Validação CPF Real: Ativa'
                      : 'Modo Teste (CPF Real Inativo)'}
                  </span>
                </div>
                <input
                  type="text"
                  required
                  value={regCpf}
                  onChange={(e) => setRegCpf(formatCpfMask(e.target.value))}
                  placeholder="000.000.000-00"
                  maxLength={14}
                  className={`w-full px-3.5 py-2.5 text-sm bg-white border rounded-lg focus:outline-none focus:ring-2 ${
                    cpfDuplicateExists
                      ? 'border-red-400 focus:ring-red-600'
                      : 'border-stone-300 focus:ring-zinc-900'
                  }`}
                />
                {cpfChecking && (
                  <p className="text-[11px] text-zinc-500">Verificando disponibilidade do CPF...</p>
                )}
                {!cpfChecking && regCpfDigits.length === 11 && cpfDuplicateExists && (
                  <p className="text-[11px] font-semibold text-red-700 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Este CPF já está cadastrado em outra conta.</span>
                  </p>
                )}
                {!cpfChecking && regCpfDigits.length === 11 && !cpfDuplicateExists && (
                  <div className="space-y-0.5">
                    <p className="text-[11px] font-medium text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>CPF disponível para cadastro.</span>
                    </p>
                    {!regCpfIsRealValid && !cpfStrictValidationEnabled && (
                      <p className="text-[10px] text-amber-700">
                        CPF de teste aceito (validação de CPF real está inativa para testes; ative no Painel Admin quando colocar em produção).
                      </p>
                    )}
                    {!regCpfIsRealValid && cpfStrictValidationEnabled && (
                      <p className="text-[11px] font-semibold text-red-700">
                        CPF matemático inválido. Informe um CPF real válido.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-zinc-800">E-mail</label>
                <input
                  type="email"
                  required
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-zinc-800">
                  Telefone / WhatsApp
                </label>
                <input
                  type="tel"
                  required
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                  placeholder="11999998888"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-zinc-800">
                Senha (mínimo 6 caracteres)
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                placeholder="••••••"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>

            {/* Endereço do Cliente já no Criar Conta */}
            <div className="pt-3 border-t border-stone-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-zinc-800" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-800">
                    Endereço de Entrega
                  </h2>
                </div>
                <span className="text-[11px] text-zinc-500">
                  Enviado ao Admin para cadastro do seu frete
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-zinc-700">
                    Identificação do local
                  </label>
                  <input
                    type="text"
                    required
                    value={regAddrLabel}
                    onChange={(e) => setRegAddrLabel(e.target.value)}
                    placeholder="Ex: Casa, Trabalho"
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-zinc-700">
                    CEP <span className="text-[10px] text-emerald-700">(busca automática)</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={regZipCode}
                    onChange={(e) => handleRegCepChange(e.target.value)}
                    placeholder="00000-000"
                    maxLength={9}
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
              </div>

              {regCepFeedback && (
                <div
                  className={`text-[11px] px-2.5 py-1.5 rounded-md border ${
                    regCepLoading
                      ? 'bg-stone-100 text-zinc-600 border-stone-200'
                      : regCepFeedback.includes('automaticamente')
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
                >
                  {regCepFeedback}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1">
                  <label className="block text-xs font-medium text-zinc-700">
                    Rua / Logradouro
                  </label>
                  <input
                    type="text"
                    required
                    value={regStreet}
                    onChange={(e) => setRegStreet(e.target.value)}
                    placeholder="Ex: Rua das Flores"
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-zinc-700">Número</label>
                  <input
                    type="text"
                    required
                    value={regNumber}
                    onChange={(e) => setRegNumber(e.target.value)}
                    placeholder="Ex: 120"
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-zinc-700">
                    Complemento (opcional)
                  </label>
                  <input
                    type="text"
                    value={regComplement}
                    onChange={(e) => setRegComplement(e.target.value)}
                    placeholder="Apto, Bloco, Casa 2..."
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-zinc-700">Bairro</label>
                  <input
                    type="text"
                    required
                    value={regNeighborhood}
                    onChange={(e) => setRegNeighborhood(e.target.value)}
                    placeholder="Ex: Centro"
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <label className="block text-xs font-medium text-zinc-700">Cidade</label>
                  <input
                    type="text"
                    required
                    value={regCity}
                    onChange={(e) => setRegCity(e.target.value)}
                    placeholder="Ex: Itatiba"
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-zinc-700">UF</label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={regState}
                    onChange={(e) => setRegState(e.target.value.toUpperCase())}
                    placeholder="SP"
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
              </div>

              {regCity.trim() && (
                <div
                  className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                    isItatibaCity(regCity)
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <Truck className="w-4 h-4 shrink-0" />
                  {isItatibaCity(regCity) ? (
                    <span>
                      <strong>Cidade: Itatiba — Temos delivery!</strong> Entrega rápida na região de Itatiba.
                    </span>
                  ) : (
                    <span>
                      <strong>Cidade fora de Itatiba ({regCity.trim()}):</strong> Entrega através dos Correios — conferir valor no WhatsApp.
                    </span>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-700">
                  Ponto de referência (opcional)
                </label>
                <input
                  type="text"
                  value={regReference}
                  onChange={(e) => setRegReference(e.target.value)}
                  placeholder="Ex: Próximo à padaria central"
                  className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
            </div>

            {/* Aviso Simples de Privacidade LGPD Obrigatório */}
            <div className="p-3.5 rounded-lg bg-stone-50 border border-stone-200 space-y-2">
              <div className="text-xs font-semibold text-zinc-800">
                Aviso de Privacidade e Uso de Dados (LGPD)
              </div>
              <p className="text-xs text-zinc-600 leading-relaxed">
                <strong>O que coletamos:</strong> Nome, CPF, e-mail, telefone/WhatsApp e endereço de
                entrega cadastrado.
                <br />
                <strong>Para quê:</strong> Exclusivamente para identificar sua conta sem duplicidade,
                calcular e registrar o valor do frete e distância até o seu endereço, processar seus
                pedidos e combinar o pagamento e a entrega pelo WhatsApp da loja DeepShop Delivery.
                Seus dados não são compartilhados com terceiros.
              </p>
              <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lgpdAccepted}
                  onChange={(e) => setLgpdAccepted(e.target.checked)}
                  className="mt-0.5 rounded border-stone-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-xs font-medium text-zinc-800">
                  Li e concordo com a coleta e uso dos meus dados conforme descrito acima, a{' '}
                  <Link to="/privacidade" target="_blank" className="underline">Política de Privacidade</Link>{' '}
                  e os <Link to="/termos" target="_blank" className="underline">Termos de Uso</Link>.
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting || cpfDuplicateExists}
              className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
            >
              {submitting ? 'Criando conta e enviando endereço...' : 'Concluir Cadastro'}
            </button>
          </form>
        )}

        {mode === 'RECOVER' && (
          <form onSubmit={handleRecover} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-zinc-800">E-mail da conta</label>
              <input
                type="email"
                required
                value={recEmail}
                onChange={(e) => setRecEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 leading-relaxed">
              Para sua segurança, peça o código de redefinição à loja pelo WhatsApp. A loja vai gerar
              um código válido por 30 minutos e de uso único. Depois, informe-o abaixo.
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-zinc-800">
                Código de redefinição (6 dígitos)
              </label>
              <input
                type="text"
                inputMode="numeric"
                required
                maxLength={6}
                pattern="[0-9]{6}"
                value={recCode}
                onChange={(e) => setRecCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full px-3.5 py-2.5 text-sm tracking-widest bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-zinc-800">
                Nova senha (mínimo 6 caracteres)
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={recNewPassword}
                onChange={(e) => setRecNewPassword(e.target.value)}
                placeholder="••••••"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
            >
              {submitting ? 'Validando...' : 'Redefinir Senha'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
};
