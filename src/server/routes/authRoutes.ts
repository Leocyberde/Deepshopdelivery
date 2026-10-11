import { logServerError, logServerEvent } from '../logger.ts';
import { Express } from 'express';
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import jwt from 'jsonwebtoken';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { resolveAddressFreight } from '../../services/freightService.ts';
import {
  JWT_SECRET,
  AuthUserPayload,
  AuthRequest,
  checkRateLimit,
  resetRateLimit,
  requireAuth,
  requireAdmin,
} from '../middleware/auth.ts';
import {
  getSettingsMap,
  formatCpfMask,
  isValidBrazilianCpf,
  } from '../services/storeHelpers.ts';
import { isAdminRole } from '../governance.ts';
import { LEGAL_VERSION } from '../../config/legal.ts';
import { evaluateCustomerLoyaltyTickets } from '../services/loyaltyService.ts';

export function registerAuthRoutes(app: Express) {
  app.get('/api/auth/register-config', async (_req, res) => {
    try {
      const settingsMap = await getSettingsMap();
      res.json({
        cpfStrictValidationEnabled: settingsMap.cpf_strict_validation_enabled === 'true',
      });
    } catch {
      res.json({ cpfStrictValidationEnabled: false });
    }
  });

  app.get('/api/auth/check-cpf/:cpf', async (req, res) => {
    try {
      const limit = checkRateLimit(`cpf_check_${req.ip || 'local'}`);
      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSec));
        res.status(429).json({ error: 'Muitas tentativas de verificação. Aguarde antes de tentar novamente.' });
        return;
      }
      const rawCpf = String(req.params.cpf || '');
      const cleanCpf = rawCpf.replace(/\D/g, '');
      const settingsMap = await getSettingsMap();
      const cpfStrictValidationEnabled = settingsMap.cpf_strict_validation_enabled === 'true';

      if (rawCpf.length > 32 || !/^[\d.\-\s]+$/.test(rawCpf) || cleanCpf.length !== 11) {
        res.json({
          exists: false,
          isValidRealCpf: false,
          cpfStrictValidationEnabled,
        });
        return;
      }

      const [matchingUser] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(sql`regexp_replace(COALESCE(${schema.users.cpf}, ''), '[^0-9]', '', 'g') = ${cleanCpf}`)
        .limit(1);
      const exists = Boolean(matchingUser);
      const isValidRealCpf = isValidBrazilianCpf(cleanCpf);

      res.json({
        exists,
        isValidRealCpf,
        cpfStrictValidationEnabled,
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao verificar CPF.' });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const ipKey = `reg_${req.ip || 'local'}`;
      const limit = checkRateLimit(ipKey);
      if (!limit.allowed) {
        res.status(429).json({
          error: `Muitas tentativas de cadastro. Aguarde ${limit.retryAfterSec} segundos.`,
        });
        return;
      }

      const {
        name,
        cpf,
        email,
        phone,
        password,
        lgpdAccepted,
        address,
        label,
        zipCode,
        street,
        number,
        complement,
        neighborhood,
        city,
        state,
        reference,
      } = req.body;

      if (typeof name !== 'string' || typeof email !== 'string' || typeof phone !== 'string' || typeof password !== 'string' || !name.trim() || !email.trim() || !phone.trim() || !password) {
        res.status(400).json({ error: 'Preencha nome, e-mail, telefone e senha.' });
        return;
      }
      if (name.trim().length > 120 || email.trim().length > 254 || phone.trim().length > 30 || password.length > 128) {
        res.status(400).json({ error: 'Um ou mais campos excedem o tamanho permitido.' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        res.status(400).json({ error: 'Informe um e-mail válido.' });
        return;
      }
      if (!lgpdAccepted) {
        res.status(400).json({
          error: 'É necessário aceitar o aviso de privacidade (LGPD) para criar sua conta.',
        });
        return;
      }
      if (String(password).length < 6) {
        res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
        return;
      }

      const settingsMap = await getSettingsMap();
      const cpfStrictValidationEnabled = settingsMap.cpf_strict_validation_enabled === 'true';

      let formattedCpf: string | null = null;
      if (cpf !== undefined && cpf !== null && String(cpf).trim() !== '') {
        const rawCpf = String(cpf);
        const cleanCpf = rawCpf.replace(/\D/g, '');
        if (rawCpf.length > 32 || !/^[\d.\-\s]+$/.test(rawCpf)) {
          res.status(400).json({ error: 'Informe um CPF válido com 11 números.' });
          return;
        }
        if (cleanCpf.length !== 11) {
          res.status(400).json({ error: 'Informe os 11 números do CPF.' });
          return;
        }
        // Requisito 1: Validação de CPF real (inativo no momento de teste; ativo quando habilitado para produção)
        if (cpfStrictValidationEnabled && !isValidBrazilianCpf(cleanCpf)) {
          res.status(400).json({
            error: 'CPF inválido. Por favor, informe um CPF verdadeiro válido.',
          });
          return;
        }
        // Requisito 2: Verificar se já tem o CPF cadastrado para criar a conta
        const [existingCpf] = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(sql`regexp_replace(COALESCE(${schema.users.cpf}, ''), '[^0-9]', '', 'g') = ${cleanCpf}`)
          .limit(1);
        const cpfAlreadyExists = Boolean(existingCpf);
        if (cpfAlreadyExists) {
          res.status(400).json({
            error: 'Este CPF já está cadastrado em outra conta.',
          });
          return;
        }
        formattedCpf = formatCpfMask(cleanCpf);
      }

      const cleanEmail = String(email).trim().toLowerCase();
      const existing = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, cleanEmail));

      if (existing.length > 0) {
        res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
        return;
      }

      // Resolve address payload (either nested in `address` or top-level fields)
      const addrInput = address || {
        label,
        zipCode,
        street,
        number,
        complement,
        neighborhood,
        city,
        state,
        reference,
      };
      if (address !== undefined && (!address || typeof address !== 'object' || Array.isArray(address))) {
        res.status(400).json({ error: 'Endereço inválido.' });
        return;
      }
      const addressFieldLimits: Record<string, number> = {
        label: 50, zipCode: 12, street: 120, number: 30, complement: 100,
        neighborhood: 100, city: 100, state: 2, reference: 300,
      };
      for (const [field, maxLength] of Object.entries(addressFieldLimits)) {
        const value = addrInput?.[field];
        if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > maxLength)) {
          res.status(400).json({ error: 'Um ou mais campos do endereço são inválidos ou excedem o tamanho permitido.' });
          return;
        }
      }
      const hasAddressFields = Boolean(
        addrInput &&
          addrInput.zipCode &&
          addrInput.street &&
          addrInput.number &&
          addrInput.neighborhood &&
          addrInput.city &&
          addrInput.state
      );

      const passwordHash = await bcrypt.hash(String(password), 10);

      // Cria o cliente, o endereço inicial (Requisito 3) e a notificação para o painel Admin em transação
      const { newUser, createdAddress, createdAdminNotification } = await db.transaction(
        async (tx) => {
          const [insertedUser] = await tx
            .insert(schema.users)
            .values({
              name: String(name).trim(),
              cpf: formattedCpf,
              email: cleanEmail,
              phone: String(phone).trim(),
              passwordHash,
              role: 'CUSTOMER',
              status: 'ACTIVE',
              privacyVersion: LEGAL_VERSION,
              privacyAcceptedAt: new Date(),
              termsVersion: LEGAL_VERSION,
              termsAcceptedAt: new Date(),
            })
            .returning();

          let insertedAddress: typeof schema.addresses.$inferSelect | null = null;
          if (hasAddressFields) {
            const [addrRow] = await tx
              .insert(schema.addresses)
              .values({
                userId: insertedUser.id,
                label: String(addrInput.label || 'Casa').trim(),
                zipCode: String(addrInput.zipCode).trim(),
                street: String(addrInput.street).trim(),
                number: String(addrInput.number).trim(),
                complement: addrInput.complement ? String(addrInput.complement).trim() : null,
                neighborhood: String(addrInput.neighborhood).trim(),
                city: String(addrInput.city).trim(),
                state: String(addrInput.state).trim().toUpperCase().slice(0, 2),
                reference: addrInput.reference ? String(addrInput.reference).trim() : null,
                deliveryDistanceKm: null,
                deliveryFee: null,
                deliveryFeeStatus: 'PENDING',
                deliveryFeeSource: 'MANUAL',
                latitude: null,
                longitude: null,
              })
              .returning();
            insertedAddress = addrRow;
          }

          const addrSummary = insertedAddress
            ? `${insertedAddress.street}, ${insertedAddress.number}${
                insertedAddress.complement ? ` (${insertedAddress.complement})` : ''
              } — ${insertedAddress.neighborhood}, ${insertedAddress.city}/${insertedAddress.state} (CEP ${
                insertedAddress.zipCode
              })`
            : 'Endereço ainda não informado';

          const [adminNotif] = await tx
            .insert(schema.adminNotifications)
            .values({
              type: 'NEW_CUSTOMER',
              customerId: insertedUser.id,
              addressId: insertedAddress ? insertedAddress.id : null,
              title: `Novo Cliente Cadastrado: ${insertedUser.name}`,
              message: `CPF: ${insertedUser.cpf || 'Não informado'} · Tel: ${
                insertedUser.phone
              } · Endereço: ${addrSummary}. Cadastre a distância e o frete deste cliente.`,
              isRead: false,
              popupDismissed: false,
            })
            .returning();

          return {
            newUser: insertedUser,
            createdAddress: insertedAddress,
            createdAdminNotification: adminNotif,
          };
        }
      );

      const payload: AuthUserPayload = {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: 'CUSTOMER',
        sessionVersion: newUser.sessionVersion,
      };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

      const loyalty = await evaluateCustomerLoyaltyTickets(newUser.id);
      logServerEvent('auth.registration.succeeded', 'info', { userId: newUser.id, role: 'CUSTOMER', result: 'created' });

      res.status(201).json({
        token,
        user: {
          id: newUser.id,
          name: newUser.name,
          cpf: newUser.cpf,
          email: newUser.email,
          phone: newUser.phone,
          role: newUser.role,
          status: newUser.status,
          freeDeliveryTickets: loyalty.freeDeliveryTickets,
          loyalty,
          eligibleForFirstOrderFreeDelivery: loyalty.isFirstOrderEligible,
        },
        address: createdAddress
          ? {
              ...createdAddress,
              freight: resolveAddressFreight(createdAddress),
            }
          : null,
        adminNotificationId: createdAdminNotification.id,
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro interno ao criar conta.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      const cleanEmail = String(email || '').trim().toLowerCase();
      const rateKey = `login_${req.ip || 'local'}_${cleanEmail}`;

      const limit = checkRateLimit(rateKey);
      if (!limit.allowed) {
        logServerEvent('auth.login.rate_limited', 'warn', { status: 429, result: 'denied', reason: 'rate_limit' });
        res.status(429).json({
          error: `Limite de tentativas de login excedido. Tente novamente em ${limit.retryAfterSec} segundos.`,
        });
        return;
      }

      if (!cleanEmail || !password) {
        res.status(400).json({ error: 'Informe e-mail e senha.' });
        return;
      }

      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, cleanEmail));

      if (!user) {
        logServerEvent('auth.login.failed', 'warn', { status: 401, result: 'denied', reason: 'invalid_credentials' });
        res.status(401).json({
          error: `E-mail ou senha inválidos. Tentativas restantes: ${limit.remaining}.`,
        });
        return;
      }

      if (user.status !== 'ACTIVE') {
        logServerEvent('auth.login.failed', 'warn', { status: 403, result: 'denied', reason: 'account_inactive', userId: user.id, role: user.role });
        res.status(403).json({ error: 'Esta conta está desativada.' });
        return;
      }

      const valid = await bcrypt.compare(String(password), user.passwordHash);
      if (!valid) {
        logServerEvent('auth.login.failed', 'warn', { status: 401, result: 'denied', reason: 'invalid_credentials' });
        res.status(401).json({
          error: `E-mail ou senha inválidos. Tentativas restantes: ${limit.remaining}.`,
        });
        return;
      }

      resetRateLimit(rateKey);

      const payload: AuthUserPayload = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as AuthUserPayload['role'],
        sessionVersion: user.sessionVersion,
      };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

      const isAdminUser = user.role !== 'CUSTOMER';
      const loyalty = isAdminUser ? null : await evaluateCustomerLoyaltyTickets(user.id);
      logServerEvent('auth.login.succeeded', 'info', { userId: user.id, role: user.role, result: 'success' });

      res.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          cpf: user.cpf,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          freeDeliveryTickets: loyalty ? loyalty.freeDeliveryTickets : 0,
          loyalty,
          eligibleForFirstOrderFreeDelivery: loyalty ? loyalty.isFirstOrderEligible : false,
          mustChangePassword: user.mustChangePassword,
        },
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro interno ao realizar login.' });
    }
  });

  // Recuperação de senha ASSISTIDA (Etapa 1.3).
  // A rota pública antiga (/api/auth/recover-password) foi removida: ela redefinia qualquer conta
  // só com e-mail e telefone. Agora o cliente pede o código pelo WhatsApp da loja, o admin gera um
  // código de uso único (30 min) e o cliente define a nova senha com ele. Contas ADMIN ficam de fora.
  const RESET_CODE_TTL_MS = 30 * 60 * 1000;
  const RESET_CODE_MAX_ATTEMPTS = 5;

  app.post('/api/auth/admin/reset-password', async (req, res) => {
    const generic = 'Código inválido ou expirado.';
    try {
      const email=String(req.body?.email||'').trim().toLowerCase(); const code=String(req.body?.code||'').trim(); const newPassword=String(req.body?.newPassword||'');
      const limit=checkRateLimit(`admin_reset_${req.ip||'local'}_${email}`); if(!limit.allowed) return res.status(429).json({error:'Muitas tentativas. Aguarde antes de tentar novamente.'});
      if(!email||!code||newPassword.length<10) return res.status(400).json({error:generic});
      const [user]=await db.select().from(schema.users).where(eq(schema.users.email,email));
      if(!user || !['ADMIN','SUPER_ADMIN','GERENTE','OPERADOR'].includes(user.role) || user.status!=='ACTIVE' || !user.resetCodeHash || !user.resetCodeExpiresAt || user.resetCodeExpiresAt.getTime()<Date.now() || user.resetCodeAttempts>=5) return res.status(400).json({error:generic});
      if(!await bcrypt.compare(code,user.resetCodeHash)){ const attempts=user.resetCodeAttempts+1; await db.update(schema.users).set({resetCodeAttempts:attempts, ...(attempts>=5?{resetCodeHash:null,resetCodeExpiresAt:null}:{})}).where(eq(schema.users.id,user.id)); return res.status(400).json({error:generic}); }
      await db.update(schema.users).set({passwordHash:await bcrypt.hash(newPassword,12),resetCodeHash:null,resetCodeExpiresAt:null,resetCodeAttempts:0,mustChangePassword:false,updatedAt:new Date()}).where(eq(schema.users.id,user.id)); await db.insert(schema.adminAuditLogs).values({actorUserId:user.id,actorEmail:user.email,action:'RESET_ADMIN_PASSWORD',entityType:'USER',entityId:String(user.id),result:'SUCCESS',details:{channel:'admin_reset_token'},requestId:typeof req.headers['x-request-id']==='string'?req.headers['x-request-id']:null}); resetRateLimit(`admin_reset_${req.ip||'local'}_${email}`); return res.json({message:'Senha administrativa redefinida com sucesso.'});
    } catch(e){ logServerError('admin_reset_password_failed',e); return res.status(500).json({error:'Erro ao redefinir senha.'}); }
  });
  app.post(
    '/api/admin/customers/:id/reset-code',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const id = Number(req.params.id);
        const [target] = await db.select().from(schema.users).where(eq(schema.users.id, id));
        if (!target || target.role !== 'CUSTOMER') {
          res.status(404).json({ error: 'Cliente não encontrado.' });
          return;
        }
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        await db
          .update(schema.users)
          .set({
            resetCodeHash: await bcrypt.hash(code, 10),
            resetCodeExpiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
            resetCodeAttempts: 0,
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, id));
        // O código só aparece aqui, uma vez. No banco fica apenas o hash.
        res.json({ code, expiresInMinutes: 30 });
      } catch (error) {
        logServerError('server_operation_failed', error);
        res.status(500).json({ error: 'Erro ao gerar código.' });
      }
    }
  );

  app.post('/api/auth/reset-password', async (req, res) => {
    const genericError = 'Código inválido ou expirado. Peça um novo código à loja.';
    try {
      const { email, code, newPassword } = req.body;
      const cleanEmail = String(email || '').trim().toLowerCase();
      const rateKey = `reset_${req.ip || 'local'}_${cleanEmail}`;
      const limit = checkRateLimit(rateKey);
      if (!limit.allowed) {
        res.status(429).json({ error: `Muitas tentativas. Aguarde ${limit.retryAfterSec} segundos.` });
        return;
      }
      if (!cleanEmail || !code || !newPassword) {
        res.status(400).json({ error: 'Informe e-mail, código e nova senha.' });
        return;
      }
      if (String(newPassword).length < 6) {
        res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
        return;
      }

      const [user] = await db.select().from(schema.users).where(eq(schema.users.email, cleanEmail));
      if (
        !user ||
        user.role !== 'CUSTOMER' ||
        user.status !== 'ACTIVE' ||
        !user.resetCodeHash ||
        !user.resetCodeExpiresAt ||
        user.resetCodeExpiresAt.getTime() < Date.now() ||
        user.resetCodeAttempts >= RESET_CODE_MAX_ATTEMPTS
      ) {
        res.status(400).json({ error: genericError });
        return;
      }

      const ok = await bcrypt.compare(String(code).trim(), user.resetCodeHash);
      if (!ok) {
        const attempts = user.resetCodeAttempts + 1;
        await db
          .update(schema.users)
          .set(
            attempts >= RESET_CODE_MAX_ATTEMPTS
              ? { resetCodeAttempts: attempts, resetCodeHash: null, resetCodeExpiresAt: null }
              : { resetCodeAttempts: attempts }
          )
          .where(eq(schema.users.id, user.id));
        res.status(400).json({ error: genericError });
        return;
      }

      await db
        .update(schema.users)
        .set({
          passwordHash: await bcrypt.hash(String(newPassword), 10),
          resetCodeHash: null,
          resetCodeExpiresAt: null,
          resetCodeAttempts: 0,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, user.id));

      resetRateLimit(rateKey);
      res.json({ message: 'Senha redefinida com sucesso! Você já pode entrar com a nova senha.' });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao redefinir senha.' });
    }
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
    try {
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, req.user!.id));
      if (!user) {
        res.status(404).json({ error: 'Usuário não encontrado.' });
        return;
      }
      const isAdminUser = user.role !== 'CUSTOMER';
      const loyalty = isAdminUser ? null : await evaluateCustomerLoyaltyTickets(user.id);

      res.json({
        id: user.id,
        name: user.name,
        cpf: user.cpf,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        mustChangePassword: user.mustChangePassword,
        privacyVersion: user.privacyVersion,
        termsVersion: user.termsVersion,
        deletionRequestedAt: user.deletionRequestedAt,
        freeDeliveryTickets: loyalty ? loyalty.freeDeliveryTickets : 0,
        loyalty,
        eligibleForFirstOrderFreeDelivery: loyalty ? loyalty.isFirstOrderEligible : false,
      });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao buscar dados do usuário.' });
    }
  });

  app.post('/api/auth/accept-legal', requireAuth, async (req: AuthRequest, res) => {
    try {
      await db
        .update(schema.users)
        .set({
          privacyVersion: LEGAL_VERSION,
          privacyAcceptedAt: new Date(),
          termsVersion: LEGAL_VERSION,
          termsAcceptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, req.user!.id));
      res.json({ legalVersion: LEGAL_VERSION });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao registrar aceite.' });
    }
  });

  app.post('/api/auth/request-deletion', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (isAdminRole(req.user!.role)) {
        res.status(400).json({ error: 'Contas de administrador não podem solicitar exclusão por aqui.' });
        return;
      }
      const requestedAt = new Date();
      await db
        .update(schema.users)
        .set({ deletionRequestedAt: requestedAt, updatedAt: requestedAt })
        .where(eq(schema.users.id, req.user!.id));
      await db.insert(schema.adminNotifications).values({
        type: 'DATA_DELETION_REQUEST',
        customerId: req.user!.id,
        orderId: null,
        addressId: null,
        title: '⚠️ Solicitação de exclusão de dados',
        message: 'Um cliente solicitou a exclusão dos seus dados. Revise a conta e trate a solicitação conforme a política da loja e a LGPD.',
        isRead: false,
        popupDismissed: false,
      });
      res.json({ message: 'Pedido de exclusão registrado. A loja entrará em contato.' });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Erro ao registrar pedido.' });
    }
  });

  app.put('/api/auth/profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { name, phone, currentPassword, newPassword, confirmNewPassword } = req.body;
      if (!name || !phone) { res.status(400).json({ error: 'Nome e telefone são obrigatórios.' }); return; }
      const updateData: Record<string, any> = { name: String(name).trim(), phone: String(phone).trim(), updatedAt: new Date() };
      const changingPassword = typeof newPassword === 'string' && newPassword.length > 0;
      if (changingPassword) {
        const [currentUser] = await db.select({ passwordHash: schema.users.passwordHash, sessionVersion: schema.users.sessionVersion }).from(schema.users).where(eq(schema.users.id, req.user!.id));
        if (!currentPassword || !await bcrypt.compare(String(currentPassword), currentUser?.passwordHash || '')) { res.status(400).json({ error: 'A senha atual está incorreta.' }); return; }
        if (String(newPassword).length < 8 || String(newPassword).length > 128) { res.status(400).json({ error: 'A nova senha deve ter entre 8 e 128 caracteres.' }); return; }
        if (newPassword !== confirmNewPassword) { res.status(400).json({ error: 'A confirmação da nova senha não confere.' }); return; }
        updateData.passwordHash = await bcrypt.hash(String(newPassword), 12);
        updateData.mustChangePassword = false;
        updateData.sessionVersion = (currentUser?.sessionVersion || 1) + 1;
      }
      const [updated] = await db.update(schema.users).set(updateData).where(eq(schema.users.id, req.user!.id)).returning();
      res.json({ success: true, sessionInvalidated: changingPassword, user: { id: updated.id, name: updated.name, email: updated.email, phone: updated.phone, role: updated.role } });
    } catch (error) { logServerError('server_operation_failed', error); res.status(500).json({ error: 'Erro ao atualizar perfil.' }); }
  });
}
