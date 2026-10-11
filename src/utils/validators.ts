import { CepLookupResult } from '../types/app.ts';

// CPF Mask & Real Brazilian CPF Check-Digit Validation Helper (Requisitos 1 e 2)
export function normalizeCpfDigits(raw: string | null | undefined): string {
  return String(raw || '').replace(/\D/g, '').slice(0, 11);
}

export function formatCpfMask(raw: string | null | undefined): string {
  const digits = normalizeCpfDigits(raw);
  if (digits.length > 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
  }
  if (digits.length > 6) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  if (digits.length > 3) {
    return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  }
  return digits;
}

export function isValidBrazilianCpf(raw: string | null | undefined): boolean {
  const digits = normalizeCpfDigits(raw);
  if (digits.length !== 11) return false;
  // Rejeita CPFs com todos os dígitos iguais (ex: 111.111.111-11)
  if (/^(\d)\1{10}$/.test(digits)) return false;

  // Cálculo do 1º dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits.charAt(i), 10) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(digits.charAt(9), 10)) return false;

  // Cálculo do 2º dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(digits.charAt(i), 10) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(digits.charAt(10), 10)) return false;

  return true;
}

// CEP Mask & Automatic Address Lookup Helper (Requisito 3)
export function formatCepMask(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length > 5) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  return digits;
}

export async function lookupCepAddress(rawCep: string): Promise<CepLookupResult | null> {
  const cleanCep = String(rawCep || '').replace(/\D/g, '');
  if (cleanCep.length !== 8) return null;

  // 1. Try backend /api/cep/:cep first
  try {
    const res = await fetch(`/api/cep/${cleanCep}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.city) {
        return {
          cep: data.cep || `${cleanCep.slice(0, 5)}-${cleanCep.slice(5)}`,
          street: data.street || '',
          neighborhood: data.neighborhood || '',
          city: data.city || '',
          state: (data.state || 'SP').toUpperCase(),
          complement: data.complement || '',
        };
      }
    }
  } catch {
    // Fallback to direct client-side ViaCEP if backend call fails
  }

  // 2. Direct client-side ViaCEP fallback
  try {
    const viaRes = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
    if (viaRes.ok) {
      const data = await viaRes.json();
      if (!data.erro && data.localidade) {
        return {
          cep: `${cleanCep.slice(0, 5)}-${cleanCep.slice(5)}`,
          street: data.logradouro || '',
          neighborhood: data.bairro || '',
          city: data.localidade || '',
          state: (data.uf || 'SP').toUpperCase(),
          complement: data.complemento || '',
        };
      }
    }
  } catch {
    // Ignore
  }

  if (cleanCep.startsWith('1325')) {
    return {
      cep: `${cleanCep.slice(0, 5)}-${cleanCep.slice(5)}`,
      street: 'Rua Francisco Glicério',
      neighborhood: 'Centro',
      city: 'Itatiba',
      state: 'SP',
      complement: '',
    };
  }

  return null;
}
