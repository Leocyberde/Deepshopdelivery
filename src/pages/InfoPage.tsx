import React from 'react';
import { Link, useLocation } from 'react-router-dom';

type InfoSection = { title: string; body: string };
type InfoConfig = { title: string; intro: string; sections: InfoSection[] };

const PAGES: Record<string, InfoConfig> = {
  '/sobre': {
    title: 'Sobre a DeepShop Delivery',
    intro: 'A DeepShop Delivery é uma loja online de utilidades, acessórios, tecnologia e novidades para o dia a dia, com atendimento online e entrega local conforme o endereço informado.',
    sections: [
      { title: 'Uma loja local e online', body: 'Você escolhe os produtos pela vitrine, monta sua sacola e acompanha o pedido pela sua conta. Trabalhamos com produtos disponíveis para entrega e também com itens em encomenda, sempre mostrando essa condição no momento da compra.' },
      { title: 'Catálogo em movimento', body: 'Nosso catálogo reúne utilidades domésticas, acessórios, iluminação, tecnologia e outros produtos selecionados. Os preços, promoções, estoque e opções de cada item são apresentados na própria vitrine.' },
      { title: 'Disponibilidade de entrega', body: 'A disponibilidade do Delivery é verificada a partir do CEP e do endereço informado. Quando o Delivery não estiver disponível, produtos em encomenda podem continuar disponíveis para compra.' },
      { title: 'Atendimento ao cliente', body: 'Dúvidas sobre produtos, pedidos, pagamento ou entrega podem ser tratadas pela Central de Ajuda dentro da sua conta. Para acompanhar um pedido, entre em Minha Conta e consulte o histórico.' },
    ],
  },
  '/pagamento-seguranca': {
    title: 'Pagamento e segurança',
    intro: 'O pagamento é concluído em ambiente seguro do Mercado Pago, depois que o pedido é criado e os itens são reservados conforme a disponibilidade apresentada na compra.',
    sections: [
      { title: 'Como pagar', body: 'Ao finalizar o pedido, você é direcionado ao checkout hospedado do Mercado Pago. As formas de pagamento disponíveis são apresentadas pelo próprio provedor no momento do checkout e podem variar conforme a análise e as condições da transação.' },
      { title: 'Confirmação do pagamento', body: 'A DeepShop considera o pagamento confirmado somente depois que recebe a confirmação autenticada do Mercado Pago. O retorno do navegador, sozinho, não aprova nem cancela um pedido.' },
      { title: 'Proteção dos dados', body: 'Os dados necessários para cadastro, cálculo de frete, atendimento e processamento do pedido são tratados para essas finalidades. Os dados de cartão são informados diretamente no ambiente do Mercado Pago; a DeepShop não solicita que você envie dados completos do cartão por mensagem.' },
      { title: 'Cuidados importantes', body: 'Acesse o pagamento somente pelo botão exibido no pedido e mantenha seu e-mail, telefone e endereço atualizados. Nunca compartilhe sua senha ou códigos de confirmação com terceiros.' },
    ],
  },
  '/envio-entrega': {
    title: 'Prazos de envio e entrega',
    intro: 'A DeepShop Delivery faz entregas locais conforme a disponibilidade do endereço. O prazo e o valor do frete são calculados a partir do endereço escolhido e das condições reais do pedido.',
    sections: [
      { title: 'Área atendida', body: 'O endereço precisa estar completo, com CEP, rua, número, bairro, cidade e estado, para que o sistema consiga consultar a disponibilidade do Delivery e calcular o frete quando aplicável.' },
      { title: 'Prazo mostrado na compra', body: 'A previsão exibida na vitrine, na sacola ou no checkout é a referência para aquele pedido. Ela considera o horário de funcionamento, a disponibilidade dos produtos, o endereço informado e a modalidade disponível para o item.' },
      { title: 'Delivery e encomenda', body: 'Produtos com estoque disponível podem aparecer como Delivery. Produtos sem saldo, mas que aceitam encomenda, são identificados separadamente e podem ter uma janela de atendimento diferente. A condição de cada item aparece antes da confirmação do pedido.' },
      { title: 'Acompanhe seu pedido', body: 'Depois da compra, consulte Minha Conta para acompanhar o status e as notificações do pedido. Se precisar de ajuda, abra uma conversa na Central de Ajuda e informe o número do pedido.' },
      { title: 'Endereço para receber', body: 'Confira o endereço antes de concluir a compra e mantenha uma pessoa disponível para receber no local informado. Alterações depois da confirmação dependem da situação do pedido e do atendimento da loja.' },
    ],
  },
};

export const InfoPage: React.FC = () => {
  const { pathname } = useLocation();
  const page = PAGES[pathname] || PAGES['/sobre'];
  return (
    <main className="mx-auto w-full max-w-[960px] px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">DeepShop Delivery</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900">{page.title}</h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-zinc-600">{page.intro}</p>
        </div>
        <Link to="/" className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-stone-50">Voltar para a loja</Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {page.sections.map((section) => (
          <section key={section.title} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-zinc-900">{section.title}</h2>
            <p className="mt-2 text-sm leading-7 text-zinc-600">{section.body}</p>
          </section>
        ))}
      </div>
      <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-950">
        Para dúvidas sobre um pedido, acesse sua conta e use a Central de Ajuda. As políticas de privacidade, termos e trocas também estão disponíveis no rodapé.
      </div>
    </main>
  );
};
