import { AddressData, Empreendimento, SavedExtraction } from '../types';
import { AcordoRateioRecord } from '../components/RateioAcordoModule';
import { getLogoRjSrc } from './logoAsset';

export type LegalDocumentType = 'novacao' | 'confissao';

export interface NovacaoFinAcordoInput {
  id: string;
  beneficiario: string;
  referencia: string;
  valor: number;
  dataPrevista: string;
  observacao?: string;
}

export interface NovacaoFormData {
  isCasado: boolean;
  // Primeiro Devedor / Devedor
  clienteNome: string;
  clienteNacionalidade: string;
  clienteEstadoCivil: string;
  clienteProfissao: string;
  clienteRg: string;
  clienteOrgaoExpedidor: string;
  clienteCpf: string;
  clienteTelefone: string;
  clienteEmail: string;
  clienteResidencial: string;
  // Segundo Devedor (Cônjuge)
  conjugeNome: string;
  conjugeNacionalidade: string;
  conjugeProfissao: string;
  conjugeRg: string;
  conjugeOrgaoExpedidor: string;
  conjugeCpf: string;
  conjugeTelefone: string;
  conjugeEmail: string;
  // Imóvel e Contrato
  empreendimentoNome: string;
  unidadeNumero: string;
  divisaoNome: string;
  empreendimentoEndereco: string;
  vendaData: string;
  // Valores e Parcelamento (Novação)
  valorDividaOriginal: string;
  novoValor: string;
  quantidadeParcelas: string;
  valorParcela: string;
  dataPrimeiroVencimento: string;
  // Valores e Parcelamento (Confissão de Dívida - Art. 361 CC)
  dataVencimentoOriginal: string;
  valorEntrada: string;
  dataVencimento1: string;
  qtdParcelasRestantes: string;
  valorParcelaRestante: string;
  dataVencimento2: string;
  // Assinatura
  dataAssinatura: string;
  credoraRepresentante: string;
}

export function createEmptyNovacaoData(): NovacaoFormData {
  const hojeExtenso = new Date().toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return {
    isCasado: false,
    clienteNome: '',
    clienteNacionalidade: 'brasileiro(a)',
    clienteEstadoCivil: 'solteiro(a)',
    clienteProfissao: '',
    clienteRg: '',
    clienteOrgaoExpedidor: 'SSP/SP',
    clienteCpf: '',
    clienteTelefone: '',
    clienteEmail: '',
    clienteResidencial: '',
    conjugeNome: '',
    conjugeNacionalidade: 'brasileiro(a)',
    conjugeProfissao: '',
    conjugeRg: '',
    conjugeOrgaoExpedidor: 'SSP/SP',
    conjugeCpf: '',
    conjugeTelefone: '',
    conjugeEmail: '',
    empreendimentoNome: '',
    unidadeNumero: '',
    divisaoNome: '',
    empreendimentoEndereco: '',
    vendaData: '',
    valorDividaOriginal: '',
    novoValor: '',
    quantidadeParcelas: '',
    valorParcela: '',
    dataPrimeiroVencimento: '',
    dataVencimentoOriginal: '',
    valorEntrada: '',
    dataVencimento1: '',
    qtdParcelasRestantes: '',
    valorParcelaRestante: '',
    dataVencimento2: '',
    dataAssinatura: hojeExtenso,
    credoraRepresentante: '',
  };
}

export function parseCurrencyString(raw: string | number | undefined | null): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const cleaned = String(raw || '').trim();
  if (!cleaned) return 0;
  const normalized = cleaned
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatCurrencyNumberBR(value: number): string {
  if (!Number.isFinite(value)) return '0,00';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDateToBR(raw: string | undefined | null): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const [y, m, d] = trimmed.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  return trimmed;
}

export function formatAddressOneLine(addr?: AddressData | null): string {
  if (!addr) return '';
  const parts: string[] = [];
  if (addr.logradouro) {
    const num = addr.numero ? `, nº ${addr.numero}` : '';
    const comp = addr.complemento ? `, ${addr.complemento}` : '';
    parts.push(`${addr.logradouro}${num}${comp}`);
  }
  if (addr.bairro) parts.push(addr.bairro);
  if (addr.cidade || addr.estado) {
    const uf = addr.estado ? `/${addr.estado}` : '';
    parts.push(`${addr.cidade || ''}${uf}`.replace(/^\/+/, ''));
  }
  if (addr.cep) parts.push(`CEP ${addr.cep}`);
  return parts.filter(Boolean).join(', ');
}

function groupToWordsPtBr(n: number, feminine = false): string {
  if (n === 0) return '';
  const units = feminine
    ? ['', 'uma', 'duas', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove']
    : ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const teens = [
    'dez',
    'onze',
    'doze',
    'treze',
    'quatorze',
    'quinze',
    'dezesseis',
    'dezessete',
    'dezoito',
    'dezenove',
  ];
  const tens = [
    '',
    '',
    'vinte',
    'trinta',
    'quarenta',
    'cinquenta',
    'sessenta',
    'setenta',
    'oitenta',
    'noventa',
  ];
  const hundreds = feminine
    ? [
        '',
        'cento',
        'duzentas',
        'trezentas',
        'quatrocentas',
        'quinhentas',
        'seiscentas',
        'setecentas',
        'oitocentas',
        'novecentas',
      ]
    : [
        '',
        'cento',
        'duzentos',
        'trezentos',
        'quatrocentos',
        'quinhentos',
        'seiscentos',
        'setecentos',
        'oitocentos',
        'novecentos',
      ];

  if (n === 100) return 'cem';

  const h = Math.floor(n / 100);
  const rem = n % 100;
  const parts: string[] = [];

  if (h > 0) parts.push(hundreds[h]);
  if (rem >= 10 && rem <= 19) {
    parts.push(teens[rem - 10]);
  } else {
    const t = Math.floor(rem / 10);
    const u = rem % 10;
    if (t > 0) parts.push(tens[t]);
    if (u > 0) parts.push(units[u]);
  }
  return parts.join(' e ');
}

export function numeroPorExtensoPtBr(value: number, feminine = false): string {
  const n = Math.floor(Math.abs(value));
  if (!Number.isFinite(n)) return '';
  if (n === 0) return 'zero';

  const billions = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1_000);
  const remainder = n % 1_000;

  const segments: string[] = [];

  if (billions > 0) {
    segments.push(
      billions === 1 ? 'um bilhão' : `${groupToWordsPtBr(billions, false)} bilhões`
    );
  }
  if (millions > 0) {
    segments.push(
      millions === 1 ? 'um milhão' : `${groupToWordsPtBr(millions, false)} milhões`
    );
  }
  if (thousands > 0) {
    segments.push(
      thousands === 1 ? 'mil' : `${groupToWordsPtBr(thousands, feminine)} mil`
    );
  }
  if (remainder > 0) {
    segments.push(groupToWordsPtBr(remainder, feminine));
  }

  if (segments.length === 1) return segments[0];

  const last = segments[segments.length - 1];
  const prefix = segments.slice(0, -1).join(', ');
  const useE =
    remainder > 0 && (remainder < 100 || remainder % 100 === 0);
  return useE ? `${prefix} e ${last}` : `${prefix}, ${last}`;
}

export function valorPorExtensoBRL(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return '';
  const rounded = Math.round(amount * 100);
  const reais = Math.floor(rounded / 100);
  const centavos = rounded % 100;

  if (reais === 0 && centavos === 0) return 'zero reais';

  const parts: string[] = [];

  if (reais > 0) {
    const reaisWords = numeroPorExtensoPtBr(reais, false);
    const needsDe = reais >= 1_000_000 && reais % 1_000_000 === 0;
    const unidade = reais === 1 ? 'real' : needsDe ? 'de reais' : 'reais';
    parts.push(`${reaisWords} ${unidade}`);
  }

  if (centavos > 0) {
    const centavosWords = numeroPorExtensoPtBr(centavos, false);
    const unidadeCent = centavos === 1 ? 'centavo' : 'centavos';
    parts.push(`${centavosWords} ${unidadeCent}`);
  }

  return parts.join(' e ');
}

export function applyExtractionToNovacao(
  base: NovacaoFormData,
  ext: SavedExtraction,
  empreendimentos: Empreendimento[]
): NovacaoFormData {
  const c1 = ext.customers?.[0];
  const c2 = ext.customers?.[1];
  const estadoCivilLower = (c1?.estadoCivil || '').toLowerCase();
  const isCasado = Boolean(
    (c2 && c2.nome && c2.nome.trim()) ||
      estadoCivilLower.includes('casad') ||
      estadoCivilLower.includes('união') ||
      estadoCivilLower.includes('uniao')
  );

  const addrPrimary = formatAddressOneLine(c1?.address || ext.address);
  const empCatalog = empreendimentos.find(
    (e) =>
      e.nome.trim().toLowerCase() ===
      (ext.property?.empreendimento || '').trim().toLowerCase()
  );
  const empEndereco =
    ext.property?.endereco ||
    empCatalog?.endereco ||
    empCatalog?.localizacao ||
    ext.property?.localizacao ||
    [ext.property?.cidade, ext.property?.estado].filter(Boolean).join('/');

  const comissaoOriginal =
    Number(ext.valorTotalComissao || 0) ||
    Number(ext.baseCalculoComissao || 0) * ((Number(ext.percentualComissao || 0) || 0) / 100);

  return {
    ...base,
    isCasado,
    clienteNome: c1?.nome || base.clienteNome,
    clienteNacionalidade: c1?.nacionalidade || base.clienteNacionalidade || 'brasileiro(a)',
    clienteEstadoCivil: c1?.estadoCivil || base.clienteEstadoCivil || 'solteiro(a)',
    clienteProfissao: c1?.profissao || base.clienteProfissao,
    clienteRg: c1?.rgNumero || base.clienteRg,
    clienteOrgaoExpedidor: c1?.rgOrgao || base.clienteOrgaoExpedidor || 'SSP/SP',
    clienteCpf: c1?.cpf || base.clienteCpf,
    clienteTelefone: c1?.telefone || base.clienteTelefone,
    clienteEmail: c1?.email || base.clienteEmail,
    clienteResidencial: addrPrimary || base.clienteResidencial,
    conjugeNome: c2?.nome || base.conjugeNome,
    conjugeNacionalidade: c2?.nacionalidade || base.conjugeNacionalidade || 'brasileiro(a)',
    conjugeProfissao: c2?.profissao || base.conjugeProfissao,
    conjugeRg: c2?.rgNumero || base.conjugeRg,
    conjugeOrgaoExpedidor: c2?.rgOrgao || base.conjugeOrgaoExpedidor || 'SSP/SP',
    conjugeCpf: c2?.cpf || base.conjugeCpf,
    conjugeTelefone: c2?.telefone || base.conjugeTelefone,
    conjugeEmail: c2?.email || base.conjugeEmail,
    empreendimentoNome: ext.property?.empreendimento || base.empreendimentoNome,
    unidadeNumero: ext.property?.unidade || base.unidadeNumero,
    divisaoNome: ext.property?.torre || base.divisaoNome,
    empreendimentoEndereco: empEndereco || base.empreendimentoEndereco,
    vendaData: ext.created_at ? formatDateToBR(ext.created_at) : base.vendaData,
    valorDividaOriginal:
      comissaoOriginal > 0
        ? formatCurrencyNumberBR(comissaoOriginal)
        : base.valorDividaOriginal,
  };
}

function addMonthsBR(dateRaw: string | undefined | null, monthsToAdd: number): string {
  if (!dateRaw) return '';
  const trimmed = dateRaw.trim();
  let year = 0;
  let month = 0;
  let day = 0;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const [y, m, d] = trimmed.slice(0, 10).split('-').map(Number);
    year = y;
    month = m;
    day = d;
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [d, m, y] = trimmed.split('/').map(Number);
    year = y;
    month = m;
    day = d;
  } else {
    return '';
  }
  if (!year || !month || !day) return '';
  const targetMonthIndex = month - 1 + monthsToAdd;
  const targetDate = new Date(year, targetMonthIndex, 1);
  const lastDayOfMonth = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth() + 1,
    0
  ).getDate();
  targetDate.setDate(Math.min(day, lastDayOfMonth));
  const dd = String(targetDate.getDate()).padStart(2, '0');
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const yyyy = targetDate.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function applyAcordoAndRateioToNovacao(
  base: NovacaoFormData,
  acordo?: NovacaoFinAcordoInput | null,
  rateio?: AcordoRateioRecord | null
): NovacaoFormData {
  const next = { ...base };

  if (rateio) {
    const valorBase = Number(rateio.valorBaseAcordo || 0);
    const percentual = Number(rateio.percentualAcordo || 100);
    const totalAcordo = (valorBase * percentual) / 100;
    const parcelas = rateio.parcelas || [];
    const totalParcelas = parcelas.reduce(
      (sum, p) => sum + (Number(p.quantidade) || 0),
      0
    );
    const firstParcela = parcelas[0];
    const secondParcela = parcelas[1];

    if (valorBase > 0 && !next.valorDividaOriginal) {
      next.valorDividaOriginal = formatCurrencyNumberBR(valorBase);
    }
    if (totalAcordo > 0) {
      next.novoValor = formatCurrencyNumberBR(totalAcordo);
      if (!next.valorDividaOriginal) {
        next.valorDividaOriginal = formatCurrencyNumberBR(totalAcordo);
      }
    }
    if (totalParcelas > 0) {
      next.quantidadeParcelas = String(totalParcelas);
      const unitVal =
        firstParcela && Number(firstParcela.valorUnitario) > 0
          ? Number(firstParcela.valorUnitario)
          : totalAcordo / totalParcelas;
      if (unitVal > 0) {
        next.valorParcela = formatCurrencyNumberBR(unitVal);
      }
    }
    if (firstParcela?.vencimento) {
      const firstDateBR = formatDateToBR(firstParcela.vencimento);
      next.dataPrimeiroVencimento = firstDateBR;
      next.dataVencimento1 = firstDateBR;
      if (!next.dataVencimentoOriginal) {
        next.dataVencimentoOriginal = firstDateBR;
      }
    }

    // Prefill Confissão de Dívida (Sinal / 1ª Parcela + Saldo Remanescente)
    if (parcelas.length >= 2 && firstParcela && secondParcela) {
      const entradaVal = Number(firstParcela.valorUnitario || 0) * Math.max(1, Number(firstParcela.quantidade || 1));
      const remQty = parcelas.slice(1).reduce((s, p) => s + (Number(p.quantidade) || 0), 0);
      const remUnit = Number(secondParcela.valorUnitario || 0);
      if (entradaVal > 0) next.valorEntrada = formatCurrencyNumberBR(entradaVal);
      if (remQty > 0) next.qtdParcelasRestantes = String(remQty);
      if (remUnit > 0) {
        next.valorParcelaRestante = formatCurrencyNumberBR(remUnit);
      } else if (remQty > 0 && totalAcordo > entradaVal) {
        next.valorParcelaRestante = formatCurrencyNumberBR((totalAcordo - entradaVal) / remQty);
      }
      if (secondParcela.vencimento) {
        next.dataVencimento2 = formatDateToBR(secondParcela.vencimento);
      }
    } else if (firstParcela) {
      const qty1 = Math.max(1, Number(firstParcela.quantidade || 1));
      const unit1 = Number(firstParcela.valorUnitario || 0) || (totalAcordo > 0 ? totalAcordo / qty1 : 0);
      if (unit1 > 0) next.valorEntrada = formatCurrencyNumberBR(unit1);
      if (qty1 > 1) {
        next.qtdParcelasRestantes = String(qty1 - 1);
        if (unit1 > 0) next.valorParcelaRestante = formatCurrencyNumberBR(unit1);
        if (firstParcela.vencimento) {
          next.dataVencimento2 = addMonthsBR(firstParcela.vencimento, 1);
        }
      }
    }

    if (!next.empreendimentoNome && rateio.referencia) {
      next.empreendimentoNome = rateio.referencia;
    }
  }

  if (acordo) {
    if (!next.novoValor && acordo.valor > 0) {
      next.novoValor = formatCurrencyNumberBR(acordo.valor);
    }
    if (!next.valorDividaOriginal && acordo.valor > 0) {
      next.valorDividaOriginal = formatCurrencyNumberBR(acordo.valor);
    }
    if (!next.dataPrimeiroVencimento && acordo.dataPrevista) {
      const dtBR = formatDateToBR(acordo.dataPrevista);
      next.dataPrimeiroVencimento = dtBR;
      if (!next.dataVencimento1) next.dataVencimento1 = dtBR;
      if (!next.dataVencimentoOriginal) next.dataVencimentoOriginal = dtBR;
    }
    if (!next.empreendimentoNome && acordo.referencia) {
      next.empreendimentoNome = acordo.referencia;
    }
  }

  return next;
}

export function buildInitialNovacaoData(params: {
  acordo?: NovacaoFinAcordoInput | null;
  rateio?: AcordoRateioRecord | null;
  acordoRateios: AcordoRateioRecord[];
  savedExtractions: SavedExtraction[];
  empreendimentos: Empreendimento[];
}): NovacaoFormData {
  const { acordo, rateio, acordoRateios, savedExtractions, empreendimentos } = params;
  let data = createEmptyNovacaoData();

  // Find matching rateio (prefer explicitly provided rateio)
  const matchedRateio =
    rateio ||
    (acordo
      ? acordoRateios.find(
          (r) =>
            r.linkedFinAcordoId === acordo.id ||
            r.titulo.trim().toLowerCase() === acordo.beneficiario.trim().toLowerCase()
        )
      : undefined);

  // Try matching a saved extraction by reference or client name
  if (acordo || matchedRateio) {
    const searchRef = (acordo?.referencia || matchedRateio?.referencia || '').toLowerCase();
    const searchName = (acordo?.beneficiario || matchedRateio?.titulo || '').toLowerCase();
    const matchedExt = savedExtractions.find((ext) => {
      const emp = (ext.property?.empreendimento || '').toLowerCase();
      const un = (ext.property?.unidade || '').toLowerCase();
      const cli = (ext.customers?.[0]?.nome || '').toLowerCase();
      if (emp && searchRef && searchRef.includes(emp) && (!un || searchRef.includes(un))) {
        return true;
      }
      if (cli && searchName && (cli.includes(searchName) || searchName.includes(cli))) {
        return true;
      }
      return false;
    });

    if (matchedExt) {
      data = applyExtractionToNovacao(data, matchedExt, empreendimentos);
    }
  }

  data = applyAcordoAndRateioToNovacao(data, acordo, matchedRateio);
  return data;
}

function escapeHtml(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fieldOrBlank(value: string, blankPlaceholder: string): string {
  const trimmed = (value || '').trim();
  if (trimmed) return escapeHtml(trimmed);
  return `<span class="blank">${escapeHtml(blankPlaceholder)}</span>`;
}

export function buildNovacaoBodyHtml(data: NovacaoFormData): string {
  const f = fieldOrBlank;

  const valOrigNum = parseCurrencyString(data.valorDividaOriginal);
  const valOrigFormatted =
    valOrigNum > 0
      ? `R$ ${formatCurrencyNumberBR(valOrigNum)} (${valorPorExtensoBRL(valOrigNum)})`
      : `R$ ${data.valorDividaOriginal.trim() || '[VALOR DA DÍVIDA ORIGINAL]'} ([VALOR POR EXTENSO])`;

  const novoValNum = parseCurrencyString(data.novoValor);
  const novoValFormatted =
    novoValNum > 0
      ? `R$ ${formatCurrencyNumberBR(novoValNum)} (${valorPorExtensoBRL(novoValNum)})`
      : `R$ ${data.novoValor.trim() || '[NOVO VALOR]'} ([VALOR POR EXTENSO])`;

  const qtdNum = Math.floor(parseCurrencyString(data.quantidadeParcelas));
  const qtdFormatted =
    qtdNum > 0
      ? `${qtdNum} (${numeroPorExtensoPtBr(qtdNum, true)}) ${
          qtdNum === 1 ? 'parcela mensal' : 'parcelas mensais e consecutivas'
        }`
      : `[QUANTIDADE] ([QUANTIDADE POR EXTENSO]) parcelas mensais e consecutivas`;

  const valParcNum = parseCurrencyString(data.valorParcela);
  const valParcFormatted =
    valParcNum > 0
      ? `R$ ${formatCurrencyNumberBR(valParcNum)} (${valorPorExtensoBRL(valParcNum)})`
      : `R$ ${data.valorParcela.trim() || '[VALOR DA PARCELA]'} ([VALOR POR EXTENSO])`;

  const primeiroVencFormatted = data.dataPrimeiroVencimento.trim()
    ? escapeHtml(formatDateToBR(data.dataPrimeiroVencimento))
    : '<span class="blank">[DATA DO PRIMEIRO VENCIMENTO]</span>';

  const dataAssinaturaFormatted = data.dataAssinatura.trim()
    ? escapeHtml(data.dataAssinatura.trim())
    : '<span class="blank">[DATA DA ASSINATURA]</span>';

  const qualificacaoHtml = data.isCasado
    ? `
      <p><strong>PRIMEIRO DEVEDOR:</strong> ${f(data.clienteNome, '______________________________')}, ${f(data.clienteNacionalidade, '________________')}, ${f(data.clienteProfissao, '____________________')}, portador(a) da cédula de identidade RG nº ${f(data.clienteRg, '________________')}, expedida por ${f(data.clienteOrgaoExpedidor, '________')}, inscrito(a) no CPF nº ${f(data.clienteCpf, '__________________')}, telefone ${f(data.clienteTelefone, '________________')}, e-mail ${f(data.clienteEmail, '________________________')}, casado(a) com:</p>
      <p><strong>SEGUNDO DEVEDOR:</strong> ${f(data.conjugeNome, '______________________________')}, ${f(data.conjugeNacionalidade, '________________')}, ${f(data.conjugeProfissao, '____________________')}, portador(a) da cédula de identidade RG nº ${f(data.conjugeRg, '________________')}, expedida por ${f(data.conjugeOrgaoExpedidor, '________')}, inscrito(a) no CPF nº ${f(data.conjugeCpf, '__________________')}, telefone ${f(data.conjugeTelefone, '________________')}, e-mail ${f(data.conjugeEmail, '________________________')}, ambos residentes e domiciliados na ${f(data.clienteResidencial, '__________________________________________________')}.</p>
    `
    : `
      <p><strong>DEVEDOR:</strong> ${f(data.clienteNome, '______________________________')}, ${f(data.clienteNacionalidade, '________________')}, ${f(data.clienteEstadoCivil, '________________')}, ${f(data.clienteProfissao, '____________________')}, portador(a) da cédula de identidade RG nº ${f(data.clienteRg, '________________')}, expedida por ${f(data.clienteOrgaoExpedidor, '________')}, inscrito(a) no CPF nº ${f(data.clienteCpf, '__________________')}, telefone ${f(data.clienteTelefone, '________________')}, e-mail ${f(data.clienteEmail, '________________________')}, residente e domiciliado(a) na ${f(data.clienteResidencial, '__________________________________________________')}.</p>
    `;

  const devedorSignaturesHtml = data.isCasado
    ? `
      <div class="sig-item">
        <p class="sig-role">PRIMEIRO DEVEDOR:</p>
        <p class="sig-detail">${f(data.clienteNome, '______________________________________')}</p>
        <p class="sig-detail">CPF: ${f(data.clienteCpf, '________________________')}</p>
        <p class="sig-line">Assinatura: __________________________________</p>
      </div>
      <div class="sig-item">
        <p class="sig-role">SEGUNDO DEVEDOR:</p>
        <p class="sig-detail">${f(data.conjugeNome, '______________________________________')}</p>
        <p class="sig-detail">CPF: ${f(data.conjugeCpf, '________________________')}</p>
        <p class="sig-line">Assinatura: __________________________________</p>
      </div>
    `
    : `
      <div class="sig-item">
        <p class="sig-role">DEVEDOR:</p>
        <p class="sig-detail">${f(data.clienteNome, '______________________________________')}</p>
        <p class="sig-detail">CPF: ${f(data.clienteCpf, '________________________')}</p>
        <p class="sig-line">Assinatura: __________________________________</p>
      </div>
    `;

  return `
    <div class="doc-logo-wrap">
      <img src="${getLogoRjSrc()}" alt="R&J Imóveis" class="doc-logo" />
    </div>
    <h1 class="doc-title">TERMO DE NOVAÇÃO E CONFISSÃO DE DÍVIDA</h1>

    <h2>1. DAS PARTES</h2>

    <h3>1.1. DEVEDORES:</h3>
    ${qualificacaoHtml}
    <p>Doravante denominados, individualmente, DEVEDOR e, conjuntamente, DEVEDORES.</p>

    <h3>1.2. CREDORA:</h3>
    <p><strong>RODOLFO JERRY IMÓVEIS SOCIEDADE UNIPESSOAL LTDA</strong>, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº 29.881.101/0001-09 e no CRECI/SP sob o nº 39.321-J, com sede na Rua Arnóbio, nº 45, Jardim São Jorge (Raposo Tavares), São Paulo/SP, CEP 05568-040, neste ato representada na forma de seu contrato social, doravante denominada simplesmente CREDORA.</p>

    <h2>2. DO RECONHECIMENTO DA DÍVIDA E DA NOVAÇÃO</h2>

    <p><strong>2.1.</strong> Os DEVEDORES reconhecem, de forma expressa, irrevogável e irretratável, serem devedores solidários da CREDORA da quantia nominal de <strong>${escapeHtml(valOrigFormatted)}</strong>, decorrente do inadimplemento das obrigações relativas ao pagamento das comissões de intermediação imobiliária prestadas pela CREDORA, referentes à venda e compra do imóvel integrante do empreendimento <strong>${f(data.empreendimentoNome, '______________________________')}</strong>, Unidade <strong>${f(data.unidadeNumero, '________')}</strong>, divisão <strong>${f(data.divisaoNome, '______________')}</strong>, localizado na <strong>${f(data.empreendimentoEndereco, '______________________________________________')}</strong>, objeto do Contrato de Prestação de Serviços de Intermediação Imobiliária celebrado em <strong>${f(formatDateToBR(data.vendaData), '___/___/_____')}</strong>.</p>

    <p><strong>2.2.</strong> Por meio deste instrumento, as partes, de comum acordo, resolvem novar a obrigação anteriormente constituída, nos termos dos artigos 360 e seguintes do Código Civil, mediante a substituição da obrigação originária por uma nova obrigação, com condições e forma de pagamento expressamente estabelecidas neste instrumento.</p>

    <p><strong>2.3.</strong> Em decorrência da presente novação, a dívida passa a ter o valor nominal total de <strong>${escapeHtml(novoValFormatted)}</strong>, que será pago pelos DEVEDORES à CREDORA mediante boleto bancário, em <strong>${escapeHtml(qtdFormatted)}</strong>, no valor de <strong>${escapeHtml(valParcFormatted)}</strong> cada, vencendo-se a primeira em <strong>${primeiroVencFormatted}</strong> e as demais no mesmo dia dos meses subsequentes, ou no último dia do respectivo mês, caso não exista dia correspondente.</p>

    <p><strong>2.4.</strong> A presente novação é celebrada mediante concessões recíprocas quanto às condições de pagamento, não importando em renúncia da CREDORA ao recebimento integral da obrigação novada, nos termos e condições ora estabelecidos.</p>

    <h2>3. DO INADIMPLEMENTO E DO VENCIMENTO ANTECIPADO</h2>

    <p><strong>3.1.</strong> O não pagamento de qualquer parcela na respectiva data de vencimento acarretará, independentemente de aviso ou notificação judicial ou extrajudicial, o vencimento antecipado das demais parcelas vincendas, tornando imediatamente exigível a totalidade do saldo devedor remanescente da obrigação novada.</p>

    <p><strong>3.2.</strong> Sobre o saldo devedor em aberto incidirão:</p>

    <p class="alpha-item">a) Correção monetária pelo Índice Geral de Preços – Mercado (IGP-M), divulgado pela Fundação Getulio Vargas (FGV), calculada desde o vencimento da parcela inadimplida até o efetivo pagamento, observada a aplicação do índice substituto que legalmente venha a sucedê-lo ou, na sua ausência, do IPCA/IBGE;</p>

    <p class="alpha-item">b) Juros moratórios de 1% (um por cento) ao mês, calculados proporcionalmente aos dias de atraso;</p>

    <p class="alpha-item">c) Multa moratória de 2% (dois por cento) sobre o valor da obrigação inadimplida, devidamente atualizado.</p>

    <p><strong>3.3.</strong> Todos os pagamentos realizados pelos DEVEDORES serão obrigatoriamente considerados para abatimento do saldo devedor, vedada qualquer cobrança em duplicidade.</p>

    <p><strong>3.4.</strong> O vencimento antecipado não implicará o restabelecimento da obrigação originária, uma vez que esta foi substituída pela presente novação, permanecendo exigível o saldo da nova obrigação, acrescido dos encargos previstos neste instrumento.</p>

    <p><strong>3.5.</strong> O inadimplemento autoriza a CREDORA a promover a cobrança extrajudicial ou judicial do saldo devedor, inclusive mediante protesto deste instrumento e inscrição dos DEVEDORES nos órgãos de proteção ao crédito, observados os requisitos legais aplicáveis.</p>

    <h2>4. DOS HONORÁRIOS ADVOCATÍCIOS E DESPESAS DE COBRANÇA</h2>

    <p><strong>4.1.</strong> Em caso de inadimplemento e necessidade de adoção de medidas de cobrança extrajudicial ou judicial, os DEVEDORES responderão pelo pagamento de honorários advocatícios contratuais no percentual de <strong>20% (vinte por cento) sobre o valor atualizado do débito</strong>, além das despesas comprovadamente incorridas pela CREDORA para recuperação do crédito, observada a legislação aplicável.</p>

    <p><strong>4.2.</strong> Na hipótese de cobrança judicial, serão devidas, ainda, as custas processuais e demais despesas judiciais, bem como os honorários sucumbenciais que vierem a ser fixados judicialmente, observada a vedação de duplicidade de cobrança da mesma verba honorária.</p>

    <h2>5. DA EXIGIBILIDADE E DO TÍTULO EXECUTIVO EXTRAJUDICIAL</h2>

    <p><strong>5.1.</strong> Os DEVEDORES reconhecem expressamente a origem, a legitimidade e a exigibilidade da obrigação ora novada, declarando que celebram o presente instrumento de forma livre e consciente, após ciência integral de suas condições.</p>

    <p><strong>5.2.</strong> O presente instrumento, quando assinado pelos DEVEDORES e observado o disposto no artigo 784, III e § 4º, do Código de Processo Civil, constitui título executivo extrajudicial, desde que preenchidos os respectivos requisitos legais, podendo ser utilizado pela CREDORA para cobrança judicial da obrigação nele estabelecida.</p>

    <p><strong>5.3.</strong> Os DEVEDORES declaram estar cientes de que o inadimplemento poderá ensejar o protesto do presente instrumento e a adoção das medidas legais cabíveis para recuperação do crédito, respeitadas as exigências legais específicas de cada procedimento.</p>

    <h2>6. DA RESPONSABILIDADE SOLIDÁRIA</h2>

    <p><strong>6.1.</strong> Os DEVEDORES assumem expressamente, em caráter solidário, a responsabilidade pelo cumprimento integral de todas as obrigações decorrentes deste instrumento, nos termos dos artigos 264 e seguintes do Código Civil.</p>

    <p><strong>6.2.</strong> A CREDORA poderá exigir de qualquer um dos DEVEDORES, isolada ou conjuntamente, o pagamento integral da dívida, independentemente de prévia cobrança do outro DEVEDOR, sem prejuízo do direito de regresso entre os coobrigados.</p>

    <p><strong>6.3.</strong> Os DEVEDORES declaram ter plena ciência de que a solidariedade ora assumida permite à CREDORA exigir de qualquer deles a integralidade do saldo devedor, incluindo principal, encargos moratórios, despesas de cobrança e demais obrigações previstas neste instrumento.</p>

    <h2>7. DAS DISPOSIÇÕES GERAIS</h2>

    <p><strong>7.1.</strong> O presente instrumento é celebrado em caráter irrevogável e irretratável, obrigando as partes, seus herdeiros e sucessores, a qualquer título, ao fiel cumprimento de todas as suas disposições.</p>

    <p><strong>7.2.</strong> Qualquer tolerância da CREDORA quanto ao atraso ou descumprimento de obrigação prevista neste instrumento não constituirá novação adicional, renúncia de direito ou alteração contratual.</p>

    <p><strong>7.3.</strong> Qualquer alteração das condições aqui pactuadas somente terá validade mediante instrumento escrito firmado pelas partes.</p>

    <p><strong>7.4.</strong> As partes reconhecem a validade das assinaturas eletrônicas apostas neste instrumento, inclusive por meio de plataformas de assinatura eletrônica que permitam a identificação dos signatários e a verificação da integridade do documento, nos termos da legislação aplicável, especialmente do artigo 784, § 4º, do Código de Processo Civil.</p>

    <h2>8. DO FORO</h2>

    <p><strong>8.1.</strong> As partes elegem o Foro da Comarca da Capital do Estado de São Paulo para dirimir quaisquer controvérsias decorrentes deste instrumento, ressalvadas as hipóteses de competência absoluta e as regras legais de proteção ao foro do consumidor, quando aplicáveis.</p>

    <p class="closing">E, por estarem justas e contratadas, as partes firmam o presente instrumento, juntamente com as testemunhas abaixo identificadas, para que produza todos os seus efeitos jurídicos e legais.</p>

    <p class="place-date">São Paulo/SP, ${dataAssinaturaFormatted}.</p>

    <hr class="sig-divider" />

    <div class="signatures-block">
      ${devedorSignaturesHtml}

      <div class="sig-item">
        <p class="sig-role">CREDORA:</p>
        <p class="sig-detail"><strong>RODOLFO JERRY IMÓVEIS SOCIEDADE UNIPESSOAL LTDA</strong></p>
        <p class="sig-detail">Representante: ${f(data.credoraRepresentante, '_______________________________')}</p>
        <p class="sig-line">Assinatura: __________________________________</p>
      </div>

      <div class="witness-section">
        <p class="sig-role">TESTEMUNHAS:</p>
        <div class="witness-grid">
          <div class="sig-item">
            <p class="sig-detail"><strong>1.</strong></p>
            <p class="sig-detail">Nome: ______________________________________</p>
            <p class="sig-detail">CPF: ________________________________________</p>
            <p class="sig-line">Assinatura: __________________________________</p>
          </div>
          <div class="sig-item">
            <p class="sig-detail"><strong>2.</strong></p>
            <p class="sig-detail">Nome: ______________________________________</p>
            <p class="sig-detail">CPF: ________________________________________</p>
            <p class="sig-line">Assinatura: __________________________________</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function buildNovacaoPrintHtml(data: NovacaoFormData): string {
  const bodyHtml = buildNovacaoBodyHtml(data);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Termo de Novação e Confissão de Dívida</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 20mm 18mm 20mm 18mm;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: "Times New Roman", Georgia, Cambria, serif;
      color: #111827;
      margin: 0;
      padding: 0;
      font-size: 11.5pt;
      line-height: 1.52;
      text-align: justify;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .doc-logo-wrap {
      text-align: center;
      margin: 0 0 8px 0;
    }
    .doc-logo {
      height: 60px;
      width: 60px;
      object-fit: contain;
      display: inline-block;
    }
    .doc-title {
      font-size: 14pt;
      font-weight: 700;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 0 0 18px 0;
      padding-bottom: 10px;
      border-bottom: 1.5px solid #111827;
    }
    h2 {
      font-size: 11.5pt;
      font-weight: 700;
      text-transform: uppercase;
      margin: 16px 0 8px 0;
      text-align: left;
      page-break-after: avoid;
      break-after: avoid;
    }
    h3 {
      font-size: 11pt;
      font-weight: 700;
      margin: 10px 0 6px 0;
      text-align: left;
      page-break-after: avoid;
      break-after: avoid;
    }
    p {
      margin: 0 0 8px 0;
      orphans: 3;
      widows: 3;
    }
    .alpha-item {
      padding-left: 22px;
      text-indent: -16px;
    }
    .blank {
      color: #334155;
      font-weight: 600;
    }
    .closing {
      margin-top: 16px;
    }
    .place-date {
      margin-top: 14px;
      margin-bottom: 16px;
      text-align: left;
    }
    .sig-divider {
      border: 0;
      border-top: 1px solid #94a3b8;
      margin: 16px 0 18px 0;
    }
    .signatures-block {
      text-align: left;
    }
    .sig-item {
      margin-bottom: 18px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .sig-role {
      font-weight: 700;
      margin: 0 0 4px 0;
      text-transform: uppercase;
    }
    .sig-detail {
      margin: 0 0 3px 0;
    }
    .sig-line {
      margin: 10px 0 0 0;
    }
    .witness-section {
      margin-top: 20px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .witness-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
}

export function printHtmlDocumentReliable(html: string): boolean {
  const existing = document.getElementById('rj-reliable-print-iframe');
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'rj-reliable-print-iframe';
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = '210mm';
  iframe.style.height = '297mm';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  document.body.appendChild(iframe);

  const docPrint = iframe.contentDocument || iframe.contentWindow?.document;
  if (!docPrint) {
    if (document.body.contains(iframe)) {
      document.body.removeChild(iframe);
    }
    return false;
  }

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (document.body.contains(iframe)) {
      document.body.removeChild(iframe);
    }
  };

  const triggerPrint = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    try {
      win.addEventListener('afterprint', () => setTimeout(cleanup, 300), { once: true });
      win.focus();
      win.print();
    } catch {
      cleanup();
    }
    // Safety cleanup in case browser does not fire afterprint
    setTimeout(cleanup, 60000);
  };

  docPrint.open();
  docPrint.write(html);
  docPrint.close();

  setTimeout(triggerPrint, 300);
  return true;
}

export function printNovacaoDocument(data: NovacaoFormData): boolean {
  return printHtmlDocumentReliable(buildNovacaoPrintHtml(data));
}

/**
 * Builds the body HTML for "INSTRUMENTO PARTICULAR DE CONFISSÃO DE DÍVIDA E PARCELAMENTO"
 * strictly following the user's legal template and the Contrato de Corretagem visual identity.
 */
export function buildConfissaoDividaBodyHtml(data: NovacaoFormData): string {
  const f = fieldOrBlank;

  const valTotalRaw = data.valorDividaOriginal.trim() || data.novoValor.trim();
  const valTotalNum = parseCurrencyString(valTotalRaw);
  const valTotalFormatted =
    valTotalNum > 0
      ? `R$ ${formatCurrencyNumberBR(valTotalNum)} (${valorPorExtensoBRL(valTotalNum)})`
      : `R$ ${valTotalRaw || '[VALOR_TOTAL_DIVIDA]'} ([VALOR_TOTAL_DIVIDA_EXTENSO])`;

  const dataVencOriginalStr = data.dataVencimentoOriginal.trim()
    ? escapeHtml(formatDateToBR(data.dataVencimentoOriginal))
    : '<span class="blank">[DATA_VENCIMENTO_ORIGINAL]</span>';

  const valEntradaNum = parseCurrencyString(data.valorEntrada);
  const valEntradaFormatted =
    valEntradaNum > 0
      ? `R$ ${formatCurrencyNumberBR(valEntradaNum)} (${valorPorExtensoBRL(valEntradaNum)})`
      : `R$ ${data.valorEntrada.trim() || '[VALOR_ENTRADA]'} ([VALOR_ENTRADA_EXTENSO])`;

  const dataVenc1Str = data.dataVencimento1.trim()
    ? escapeHtml(formatDateToBR(data.dataVencimento1))
    : '<span class="blank">[DATA_VENCIMENTO_1]</span>';

  const qtdRestNum = Math.floor(parseCurrencyString(data.qtdParcelasRestantes));
  const qtdRestFormatted =
    qtdRestNum > 0
      ? `${qtdRestNum} (${numeroPorExtensoPtBr(qtdRestNum, true)})`
      : `[QTD_PARCELAS_RESTANTES] ([QTD_PARCELAS_RESTANTES_EXTENSO])`;

  const valParcRestNum = parseCurrencyString(data.valorParcelaRestante);
  const valParcRestFormatted =
    valParcRestNum > 0
      ? `R$ ${formatCurrencyNumberBR(valParcRestNum)} (${valorPorExtensoBRL(valParcRestNum)})`
      : `R$ ${data.valorParcelaRestante.trim() || '[VALOR_PARCELA]'} ([VALOR_PARCELA_EXTENSO])`;

  const dataVenc2Str = data.dataVencimento2.trim()
    ? escapeHtml(formatDateToBR(data.dataVencimento2))
    : '<span class="blank">[DATA_VENCIMENTO_2]</span>';

  const dataAssinaturaStr = data.dataAssinatura.trim()
    ? escapeHtml(data.dataAssinatura.trim())
    : '<span class="blank">[DATA_ASSINATURA]</span>';

  const qualificacaoDevedorHtml = data.isCasado
    ? `<p><strong>${f(data.clienteNome, '______________________________')}</strong>, ${f(data.clienteNacionalidade, '________________')}, ${f(data.clienteProfissao, '____________________')}, portador(a) da cédula de identidade RG n.º <strong>${f(data.clienteRg, '________________')} ${f(data.clienteOrgaoExpedidor, '________')}</strong>, inscrito(a) no CPF/MF sob o n.º <strong>${f(data.clienteCpf, '__________________')}</strong>, telefone ${f(data.clienteTelefone, '________________')}, e-mail ${f(data.clienteEmail, '________________________')}, casado(a) com <strong>${f(data.conjugeNome, '______________________________')}</strong>, ${f(data.conjugeNacionalidade, '________________')}, ${f(data.conjugeProfissao, '____________________')}, portador(a) da cédula de identidade RG n.º <strong>${f(data.conjugeRg, '________________')} ${f(data.conjugeOrgaoExpedidor, '________')}</strong>, inscrito(a) no CPF/MF sob o n.º <strong>${f(data.conjugeCpf, '__________________')}</strong>, telefone ${f(data.conjugeTelefone, '________________')}, e-mail ${f(data.conjugeEmail, '________________________')}, residentes e domiciliados na ${f(data.clienteResidencial, '__________________________________________________')}, doravante denominado(s) simplesmente <strong>DEVEDOR(ES)</strong>, independentemente de gênero e número.</p>`
    : `<p><strong>${f(data.clienteNome, '______________________________')}</strong>, ${f(data.clienteNacionalidade, '________________')}, ${f(data.clienteEstadoCivil, '________________')}, ${f(data.clienteProfissao, '____________________')}, portador(a) da cédula de identidade RG n.º <strong>${f(data.clienteRg, '________________')} ${f(data.clienteOrgaoExpedidor, '________')}</strong>, inscrito(a) no CPF/MF sob o n.º <strong>${f(data.clienteCpf, '__________________')}</strong>, telefone ${f(data.clienteTelefone, '________________')}, e-mail ${f(data.clienteEmail, '________________________')}, residente e domiciliado(a) na ${f(data.clienteResidencial, '__________________________________________________')}, doravante denominado(s) simplesmente <strong>DEVEDOR(ES)</strong>, independentemente de gênero e número.</p>`;

  const devedorSignaturesHtml = data.isCasado
    ? `
      <div class="sig-grid">
        <div class="sig-box">
          <div class="sig-name">${f(data.clienteNome, '____________________________________')}</div>
          <div class="sig-role">CPF: ${f(data.clienteCpf, '____________________')}</div>
        </div>
        <div class="sig-box">
          <div class="sig-name">${f(data.conjugeNome, '____________________________________')}</div>
          <div class="sig-role">CPF: ${f(data.conjugeCpf, '____________________')}</div>
        </div>
      </div>
    `
    : `
      <div class="sig-grid">
        <div class="sig-box sig-box-center">
          <div class="sig-name">${f(data.clienteNome, '____________________________________')}</div>
          <div class="sig-role">CPF: ${f(data.clienteCpf, '____________________')}</div>
        </div>
      </div>
    `;

  return `
    <div class="document">
      <!-- CABEÇALHO NO PADRÃO DO CONTRATO DE CORRETAGEM -->
      <header class="doc-header">
        <img src="${getLogoRjSrc()}" alt="R&J Imóveis" class="contract-logo" />
        <h1>INSTRUMENTO PARTICULAR DE CONFISSÃO DE DÍVIDA E PARCELAMENTO</h1>
        <div class="subtitle">RODOLFO JERRY IMÓVEIS SOCIEDADE UNIPESSOAL LTDA. &bull; CRECI/SP 39321-J</div>
      </header>

      <!-- 1. DAS PARTES -->
      <section class="partes">
        <h2 class="section-title">1. DAS PARTES</h2>

        <div class="info-card">
          <div class="info-card-title">1.1. DEVEDOR(ES):</div>
          ${qualificacaoDevedorHtml}
        </div>

        <div class="info-card">
          <div class="info-card-title">1.2. CREDORA:</div>
          <p><strong>RODOLFO JERRY IMÓVEIS SOCIEDADE UNIPESSOAL LTDA.</strong>, pessoa jurídica de direito privado, inscrita no CNPJ/MF sob o n.º <strong>29.881.101/0001-09</strong> e no CRECI/SP sob o n.º <strong>39321-J</strong>, com sede na Rua Arnóbio, n.º 45, Jardim São Jorge (Raposo Tavares), São Paulo/SP, CEP 05568-040, neste ato representada na forma de seu contrato social, doravante denominada simplesmente <strong>CREDORA</strong>.</p>
        </div>

        <p class="preamble-note">As partes acima qualificadas têm entre si justo e acertado o presente Instrumento Particular de Confissão de Dívida e Parcelamento, que se regerá pelas cláusulas e condições a seguir:</p>
      </section>

      <!-- 2. DA CONFISSÃO DE DÍVIDA E DO PARCELAMENTO -->
      <section class="clausulas">
        <h2 class="section-title">2. DA CONFISSÃO DE DÍVIDA E DO PARCELAMENTO</h2>
        <div class="clause-list">
          <div class="clause-item">
            <span class="clause-num">2.1.</span> O(s) DEVEDOR(ES) reconhece(m) e confessa(m), de forma livre, irretratável e irrevogável, dever à CREDORA a quantia líquida, certa e exigível de <strong>${escapeHtml(valTotalFormatted)}</strong>, vencida originalmente em <strong>${dataVencOriginalStr}</strong>, decorrente do inadimplemento das parcelas de honorários de intermediação imobiliária prestada pela CREDORA referente à aquisição da Unidade <strong>${f(data.unidadeNumero, '________')}</strong>, <strong>${f(data.divisaoNome, '______________')}</strong>, do empreendimento <strong>${f(data.empreendimentoNome, '______________________________')}</strong>, localizado na <strong>${f(data.empreendimentoEndereco, '______________________________________________')}</strong>, objeto do “Contrato de Prestação de Serviços de Intermediação Imobiliária” firmado em <strong>${f(formatDateToBR(data.vendaData), '___/___/_____')}</strong>.
          </div>

          <div class="clause-item">
            <span class="clause-num">2.2.</span> Por mera liberalidade da CREDORA e para facilitar a liquidação do débito ora confessado, o valor total indicado na cláusula 2.1 será pago pelo(s) DEVEDOR(ES), mediante boleto bancário emitido pela CREDORA ou transferência via PIX para a chave CNPJ <strong>29.881.101/0001-09</strong>, da seguinte forma:
            <div class="sub-clause">
              <p><strong>a) Sinal / 1ª Parcela:</strong> no valor de <strong>${escapeHtml(valEntradaFormatted)}</strong>, com vencimento em <strong>${dataVenc1Str}</strong>;</p>
              <p><strong>b) Saldo Remanescente:</strong> em <strong>${escapeHtml(qtdRestFormatted)}</strong> parcelas mensais, iguais e consecutivas no valor de <strong>${escapeHtml(valParcRestFormatted)}</strong> cada, vencendo-se a primeira delas em <strong>${dataVenc2Str}</strong> e as demais no mesmo dia dos meses subsequentes.</p>
            </div>
          </div>

          <div class="clause-item">
            <span class="clause-num">2.3.</span> Fica expressamente ajustado entre as partes que o presente acordo possui natureza meramente moratória e dilatória de prazo, <strong>não constituindo novação</strong> (art. 361 do Código Civil), permanecendo íntegras a obrigação originária e todas as suas garantias.
          </div>
        </div>
      </section>

      <!-- 3. DO INADIMPLEMENTO E DAS PENALIDADES -->
      <section class="clausulas">
        <h2 class="section-title">3. DO INADIMPLEMENTO E DAS PENALIDADES</h2>
        <div class="clause-list">
          <div class="clause-item">
            <span class="clause-num">3.1.</span> O atraso ou não pagamento de qualquer parcela na data de seu respectivo vencimento, independentemente de aviso, notificação ou interpelação judicial ou extrajudicial, implicará:
            <div class="sub-clause">
              <p><strong>a)</strong> O vencimento antecipado automático da totalidade do saldo devedor remanescente;</p>
              <p><strong>b)</strong> A perda imediata de quaisquer descontos, isenções de encargos ou abatimentos eventualmente concedidos neste acordo, restabelecendo-se o valor integral da dívida originária, abatidas apenas as quantias efetivamente pagas até a data da mora;</p>
              <p><strong>c)</strong> A incidência, sobre o saldo devedor atualizado desde o vencimento original (<strong>${dataVencOriginalStr}</strong>), de correção monetária positiva pelo IGP-M/FGV (ou índice oficial substituto), juros moratórios de 1% (um por cento) ao mês pro rata die, multa moratória irredutível de 2% (dois por cento) sobre o montante corrigido e honorários advocatícios de 20% (vinte por cento) em caso de cobrança extrajudicial ou judicial, além de custas processuais e emolumentos de cartório.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 4. DA EXECUÇÃO E DISPOSIÇÕES GERAIS -->
      <section class="clausulas">
        <h2 class="section-title">4. DA EXECUÇÃO E DISPOSIÇÕES GERAIS</h2>
        <div class="clause-list">
          <div class="clause-item">
            <span class="clause-num">4.1.</span> O(s) DEVEDOR(ES) reconhece(m) que este instrumento constitui Título Executivo Extrajudicial, nos termos do art. 784, inciso III (e § 4º, quando assinado eletronicamente), do Código de Processo Civil, autorizando a CREDORA, em caso de inadimplemento, a promover o protesto do título em cartório (CENPROT) e a inclusão do(s) nome(s) do(s) DEVEDOR(ES) nos cadastros de proteção ao crédito (SPC, Serasa, Boa Vista e congêneres), observadas as comunicações legais cabíveis.
          </div>

          <div class="clause-item">
            <span class="clause-num">4.2.</span> O(s) DEVEDOR(ES) renuncia(m) expressamente a qualquer alegação futura de desconhecimento, vício de consentimento ou nulidade quanto à origem, liquidez, certeza e exigibilidade da dívida ora confessada.
          </div>

          <div class="clause-item">
            <span class="clause-num">4.3.</span> Havendo mais de um devedor, todos respondem solidariamente pelo cumprimento integral das obrigações assumidas neste instrumento, nos termos dos artigos 264 e 275 do Código Civil, renunciando expressamente ao benefício de ordem previsto no art. 827 do Código Civil.
          </div>

          <div class="clause-item">
            <span class="clause-num">4.4.</span> A eventual tolerância da CREDORA quanto ao atraso no pagamento de qualquer parcela não implicará novação, renúncia de direitos ou alteração das condições pactuadas.
          </div>

          <div class="clause-item">
            <span class="clause-num">4.5.</span> Este instrumento obriga as partes, seus herdeiros e sucessores a qualquer título, elegendo-se o Foro da Comarca da Capital do Estado de São Paulo/SP para dirimir quaisquer questões dele oriundas, com renúncia expressa a qualquer outro, por mais privilegiado que seja.
          </div>
        </div>

        <p class="closing-note">E, por estarem assim justas e contratadas, assinam o presente instrumento em meio físico ou eletrônico, nos termos da Medida Provisória n.º 2.200-2/2001, da Lei n.º 14.063/2020 e do art. 784, § 4º, do Código de Processo Civil, juntamente com 2 (duas) testemunhas, quando aplicável.</p>
      </section>

      <!-- ASSINATURAS (UNIDADE VISUAL DO CONTRATO DE CORRETAGEM) -->
      <section class="assinaturas">
        <h2 class="section-title">ASSINATURAS</h2>

        <div class="sig-date">São Paulo/SP, ${dataAssinaturaStr}.</div>

        <div class="sig-group-label">DEVEDOR(ES):</div>
        ${devedorSignaturesHtml}

        <div class="sig-group-label" style="margin-top: 14px;">CREDORA:</div>
        <div class="sig-grid">
          <div class="sig-box sig-box-center">
            <div class="sig-name">RODOLFO JERRY IMÓVEIS SOCIEDADE UNIPESSOAL LTDA.</div>
            <div class="sig-role">CNPJ: 29.881.101/0001-09</div>
          </div>
        </div>

        <div class="sig-group-label" style="margin-top: 14px;">TESTEMUNHAS:</div>
        <div class="sig-grid">
          <div class="sig-box sig-witness">
            <div class="sig-name">1. TESTEMUNHA</div>
            <div class="sig-role sig-witness-line">Nome: ____________________________________</div>
            <div class="sig-role sig-witness-line">CPF: _____________________________________</div>
          </div>
          <div class="sig-box sig-witness">
            <div class="sig-name">2. TESTEMUNHA</div>
            <div class="sig-role sig-witness-line">Nome: ____________________________________</div>
            <div class="sig-role sig-witness-line">CPF: _____________________________________</div>
          </div>
        </div>
      </section>
    </div>
  `;
}

/**
 * Full standalone print HTML for "INSTRUMENTO PARTICULAR DE CONFISSÃO DE DÍVIDA E PARCELAMENTO"
 * matching the exact visual identity of the Contrato de Corretagem (Arial, #0f172a, #f1f5f9 bars, .info-card, .sig-box).
 */
export function buildConfissaoDividaPrintHtml(data: NovacaoFormData): string {
  const bodyHtml = buildConfissaoDividaBodyHtml(data);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Instrumento Particular de Confissão de Dívida e Parcelamento</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 15mm 18mm 15mm 18mm;
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 9pt;
      line-height: 1.32;
      color: #1e293b;
      background: #ffffff;
    }

    .document {
      width: 100%;
      max-width: 210mm;
      margin: 0 auto;
      background: #ffffff;
      padding: 12mm 14mm;
      box-sizing: border-box;
    }

    /* Cabeçalho no padrão do Contrato de Corretagem */
    .doc-header {
      text-align: center;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }

    .doc-header .contract-logo {
      height: 62px;
      width: 62px;
      object-fit: contain;
      display: block;
      margin: 0 auto 5px auto;
    }

    .doc-header h1 {
      font-size: 12.5pt;
      font-weight: bold;
      color: #0f172a;
      margin: 2px 0 3px 0;
      text-transform: uppercase;
      text-align: center;
      letter-spacing: 0.5px;
    }

    .doc-header .subtitle {
      font-size: 8pt;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 1px;
      font-weight: bold;
      text-align: center;
    }

    h1, h2, h3, .section-title {
      break-after: avoid;
      page-break-after: avoid;
    }

    h2.section-title {
      font-size: 9.5pt;
      font-weight: bold;
      color: #0f172a;
      border-left: 3px solid #0f172a;
      padding: 2.5px 0 2.5px 7px;
      margin-top: 9px;
      margin-bottom: 5px;
      text-transform: uppercase;
      background: #f1f5f9;
    }

    p {
      margin-top: 0;
      margin-bottom: 4px;
      line-height: 1.32;
      text-align: justify;
      orphans: 2;
      widows: 2;
    }

    .preamble-note {
      margin-top: 6px;
      margin-bottom: 4px;
      font-size: 9pt;
      color: #1e293b;
    }

    .closing-note {
      margin-top: 8px;
      margin-bottom: 6px;
      font-size: 9pt;
      color: #1e293b;
    }

    /* Blocos de Informação (.info-card do Contrato de Corretagem) */
    .info-card {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 6px 8px;
      margin-bottom: 5px;
    }

    .info-card-title {
      font-weight: bold;
      color: #0f172a;
      margin-bottom: 2px;
      font-size: 8.8pt;
      text-transform: uppercase;
    }

    .info-card p {
      margin: 0;
      font-size: 8.8pt;
      color: #334155;
      line-height: 1.3;
    }

    /* Cláusulas Contratuais */
    .clause-list {
      margin: 0;
      padding: 0;
    }

    .clause-item {
      margin-top: 4px;
      margin-bottom: 5px;
      text-align: justify;
      font-size: 9pt;
      line-height: 1.32;
      color: #1e293b;
    }

    .clause-num {
      font-weight: bold;
      color: #0f172a;
    }

    .sub-clause {
      margin-left: 14px;
      margin-top: 3px;
      font-size: 8.9pt;
    }

    .sub-clause p {
      margin-bottom: 3px;
    }

    .blank {
      color: #334155;
      font-weight: 600;
    }

    /* Assinaturas (Unidade Visual protegida do Contrato de Corretagem) */
    .assinaturas {
      break-inside: avoid;
      page-break-inside: avoid;
      margin-top: 10px;
    }

    .sig-date {
      font-size: 9pt;
      font-weight: bold;
      margin: 6px 0 12px 0;
      text-align: center;
      color: #0f172a;
    }

    .sig-group-label {
      font-size: 8pt;
      font-weight: bold;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin-bottom: 18px;
      text-align: left;
    }

    .sig-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px 18px;
      margin-top: 4px;
    }

    .sig-box {
      border-top: 1px solid #334155;
      padding-top: 4px;
      text-align: center;
      font-size: 8.5pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .sig-box-center {
      grid-column: span 2;
      width: 65%;
      margin: 0 auto;
    }

    .sig-name {
      font-weight: bold;
      color: #0f172a;
      text-transform: uppercase;
      font-size: 8.3pt;
    }

    .sig-role {
      color: #64748b;
      font-size: 7.8pt;
      margin-top: 2px;
    }

    .sig-witness {
      text-align: left;
    }

    .sig-witness .sig-name {
      text-align: center;
      margin-bottom: 4px;
    }

    .sig-witness-line {
      text-align: left;
      color: #334155;
      font-size: 7.8pt;
      margin-top: 3px;
    }

    @media print {
      body {
        margin: 0 !important;
        padding: 0 !important;
        background: #ffffff !important;
      }

      .document {
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        box-shadow: none !important;
      }

      h1, h2, h3, .section-title {
        break-after: avoid;
        page-break-after: avoid;
      }

      .assinaturas {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
}
