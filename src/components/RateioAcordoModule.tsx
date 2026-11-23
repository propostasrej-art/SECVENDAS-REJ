import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  RefreshCw,
  PieChart,
  ShieldCheck,
  Wallet,
  AlertCircle,
  AlertTriangle,
  Save,
  Loader2,
  Edit2,
  Printer,
  Download,
  Calendar,
  Plus,
  Info,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Users,
  UserPlus,
  Search,
  Trash2,
  Table,
  Workflow,
  CreditCard,
  Copy,
  CheckCircle2,
  FileText,
  FileSpreadsheet,
  Handshake,
  Sparkles,
  Check,
  X,
} from 'lucide-react';
import {
  AddressData,
  CargoCadastro,
  Empreendimento,
  ExtractionResult,
  FormaPagamentoComissao,
  InstallmentTypeConfig,
  PaymentInstallment,
  SavedExtraction,
} from '../types';
import {
  calcularRateioCascata,
  gerarDiagnosticoEspecialista,
  obterRateioConsolidado,
  WaterfallResult,
} from '../lib/waterfallCalculator';
import { processarProposta } from '../lib/commissionCalculator';
import {
  buildWebropaySheetData,
  generateWebropayExcel,
  WEBROPAY_TIPOS_OPERACAO,
  WebropayPagadorOverride,
} from '../lib/webropayExporter';
import {
  downloadHtmlFile,
  generateRateioPdf,
  generateWebropayPdf,
  printHtmlDirect,
} from '../utils/printEngine';
import { getLogoRjSrc } from '../utils/logoAsset';

export interface AcordoParticipanteItem {
  role: string;
  name: string;
  percentage: number;
  taxaPremio?: number;
  deduction?: number;
  hideAndSum?: boolean;
  priorityRule?: 'ATO_FULL' | 'ANTECIPADO' | 'ORDINARIO';
}

export interface AcordoPagadorData {
  nomeRazaoSocial?: string;
  email?: string;
  cpfCnpj?: string;
  telefone?: string;
  cep?: string;
  endereco?: string;
  nomeEmpreendimento?: string;
  torreUnidade?: string;
  tipo?: string;
  dataVenda?: string;
  valorVenda?: number;
  valorComissao?: number;
  idExterno?: string;
}

export interface AcordoRateioRecord {
  id: string;
  titulo: string;
  referencia: string;
  modalidade: FormaPagamentoComissao;
  valorBaseAcordo: number;
  percentualAcordo: number;
  status: 'liberado' | 'em_validacao' | 'retido' | 'nf_emitida';
  observacao: string;
  parcelas: PaymentInstallment[];
  participantes: AcordoParticipanteItem[];
  pagador?: AcordoPagadorData;
  linkedProposalId?: string;
  manualWaterfall?: WaterfallResult | null;
  isManual?: boolean;
  linkedFinAcordoId?: string;
  created_at: string;
  updated_at: string;
}

interface RateioAcordoModuleProps {
  acordos: AcordoRateioRecord[];
  activeAcordoId: string | null;
  onSelectAcordoId: (id: string | null) => void;
  onSaveAcordo: (record: AcordoRateioRecord) => Promise<void>;
  onDeleteAcordo: (id: string) => Promise<void>;
  cargos: CargoCadastro[];
  installmentConfigs: InstallmentTypeConfig[];
  proposal?: ExtractionResult | null;
  savedExtractions?: SavedExtraction[];
  empreendimentos?: Empreendimento[];
  proposalPayments?: PaymentInstallment[];
  proposalVgv?: number;
  proposalReference?: string;
  proposalCommissionPct?: number;
  proposalParties?: Array<{
    role: string;
    name: string;
    percentage: number;
    taxaPremio?: number;
    deduction?: number;
    hideAndSum?: boolean;
  }>;
  isReadOnly?: boolean;
  onBack?: () => void;
  backLabel?: string;
  compactHeader?: boolean;
  onOpenNovacaoPrint?: (record: AcordoRateioRecord, docType?: 'novacao' | 'confissao') => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const DEFAULT_PARTIES: AcordoParticipanteItem[] = [
  { role: 'Corretor', name: '', percentage: 50, taxaPremio: 0, deduction: 0 },
  { role: 'Gerente', name: '', percentage: 10, taxaPremio: 0, deduction: 0 },
  { role: 'Diretor de Vendas', name: '', percentage: 10, taxaPremio: 0, deduction: 0 },
  { role: 'Imobiliária', name: '', percentage: 30, taxaPremio: 0, deduction: 0 },
];

const formatBRL = (val: number) =>
  (Number(val) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatPctBr = (val: number, digits = 2) =>
  (Number(val) || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const formatCurrencyInput = (val?: number) => {
  const num = Number(val) || 0;
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const parseCurrencyInput = (raw: string) => {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return 0;
  return Number((parseInt(digits, 10) / 100).toFixed(2));
};

const formatDateBR = (date: Date) => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const isoToDateBR = (iso?: string) => {
  if (!iso) return formatDateBR(new Date());
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(iso.trim())) return iso.trim();
  const parsed = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`);
  if (isNaN(parsed.getTime())) return iso;
  return formatDateBR(parsed);
};

const formatDateMaskBR = (val: string) => {
  const digits = val.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const addMonthsBR = (baseIsoOrBr: string, monthsToAdd: number): string => {
  let d = new Date();
  const clean = (baseIsoOrBr || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    const [y, m, day] = clean.slice(0, 10).split('-').map(Number);
    d = new Date(y, m - 1, day, 12, 0, 0);
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) {
    const [day, m, y] = clean.split('/').map(Number);
    d = new Date(y, m - 1, day, 12, 0, 0);
  }
  const target = new Date(d.getFullYear(), d.getMonth() + monthsToAdd, d.getDate(), 12, 0, 0);
  return formatDateBR(target);
};

const createBlankAcordoRecord = (defaults?: {
  titulo?: string;
  referencia?: string;
  valorBase?: number;
  percentual?: number;
  parcelas?: PaymentInstallment[];
  participantes?: AcordoParticipanteItem[];
}): AcordoRateioRecord => {
  const nowIso = new Date().toISOString();
  const todayBr = formatDateBR(new Date());
  const baseVal = defaults?.valorBase && defaults.valorBase > 0 ? defaults.valorBase : 10000;
  const pct = defaults?.percentual && defaults.percentual > 0 ? defaults.percentual : 100;
  const defaultParcelas: PaymentInstallment[] =
    defaults?.parcelas && defaults.parcelas.length > 0
      ? defaults.parcelas.map((p) => ({ ...p }))
      : [
          {
            quantidade: 1,
            tipo: 'SINAL / ATO',
            valorUnitario: Number((baseVal * 0.2).toFixed(2)),
            vencimento: todayBr,
            valorTotal: Number((baseVal * 0.2).toFixed(2)),
          },
          {
            quantidade: 4,
            tipo: 'MENSAL',
            valorUnitario: Number(((baseVal * 0.8) / 4).toFixed(2)),
            vencimento: addMonthsBR(todayBr, 1),
            valorTotal: Number((baseVal * 0.8).toFixed(2)),
          },
        ];

  return {
    id: `rateio_acordo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    titulo: defaults?.titulo || 'Novo Rateio de Acordo',
    referencia: defaults?.referencia || '',
    modalidade: 'PAGADORIA',
    valorBaseAcordo: baseVal,
    percentualAcordo: pct,
    status: 'liberado',
    observacao: '',
    parcelas: defaultParcelas,
    participantes:
      defaults?.participantes && defaults.participantes.length > 0
        ? defaults.participantes.map((p) => ({ ...p }))
        : DEFAULT_PARTIES.map((p) => ({ ...p })),
    manualWaterfall: null,
    isManual: false,
    created_at: nowIso,
    updated_at: nowIso,
  };
};

const escapePrintHtml = (val: unknown): string =>
  String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatAddressOneLine = (addr?: AddressData | null): string => {
  if (!addr) return '';
  const parts: string[] = [];
  if (addr.logradouro) {
    let line = addr.logradouro;
    if (addr.numero) line += `, ${addr.numero}`;
    if (addr.complemento) line += ` (${addr.complemento})`;
    parts.push(line);
  }
  if (addr.bairro) parts.push(addr.bairro);
  if (addr.cidade) {
    parts.push(addr.estado ? `${addr.cidade}/${addr.estado}` : addr.cidade);
  }
  return parts.join(' - ');
};

const extractPagadorFromProposal = (
  source: ExtractionResult | SavedExtraction | null | undefined,
  empreendimentos: Empreendimento[]
): AcordoPagadorData => {
  if (!source) return {};
  const customer =
    (source.customers && source.customers.length > 0 ? source.customers[0] : null) ||
    (source as any).customer ||
    null;
  const address = source.address || customer?.address;
  const property = source.property;
  const empCatalog = empreendimentos.find(
    (e) =>
      e.nome &&
      property?.empreendimento &&
      e.nome.trim().toLowerCase() === property.empreendimento.trim().toLowerCase()
  );

  const endereco =
    formatAddressOneLine(address) ||
    property?.endereco ||
    empCatalog?.endereco ||
    empCatalog?.localizacao ||
    property?.localizacao ||
    [property?.cidade, property?.estado].filter(Boolean).join('/') ||
    '';

  const torreUnidade =
    [
      property?.torre ? `Torre ${property.torre}` : '',
      property?.unidade ? `Unidade ${property.unidade}` : '',
    ]
      .filter(Boolean)
      .join(' / ') ||
    property?.unidade ||
    '';

  const rawDate =
    (source as any).data_venda ||
    (source as any).dataVenda ||
    source.payments?.[0]?.vencimento ||
    (source as any).created_at ||
    '';
  const dataVenda = rawDate ? isoToDateBR(String(rawDate)) : '';

  const sumProp = (source.payments || []).reduce((acc, p) => acc + (Number(p.valorTotal) || 0), 0);
  const valorVenda =
    Number(source.valorTotalProposta || 0) > 0
      ? Number(source.valorTotalProposta)
      : sumProp > 0
        ? Number(sumProp.toFixed(2))
        : undefined;

  return {
    nomeRazaoSocial: customer?.nome || '',
    email: customer?.email || '',
    cpfCnpj: customer?.cpf || '',
    telefone: customer?.telefone || '',
    cep: address?.cep || customer?.address?.cep || '',
    endereco,
    nomeEmpreendimento: property?.empreendimento || '',
    torreUnidade,
    tipo: 'Acordo',
    dataVenda,
    valorVenda,
    idExterno: source.id || '',
  };
};

export const RateioAcordoModule: React.FC<RateioAcordoModuleProps> = ({
  acordos,
  activeAcordoId,
  onSelectAcordoId,
  onSaveAcordo,
  onDeleteAcordo,
  cargos,
  installmentConfigs,
  proposal,
  savedExtractions = [],
  empreendimentos = [],
  proposalPayments,
  proposalVgv,
  proposalReference,
  proposalCommissionPct,
  proposalParties,
  isReadOnly = false,
  onBack,
  backLabel = 'Voltar',
  compactHeader = false,
  onOpenNovacaoPrint,
  showToast,
}) => {
  const [draft, setDraft] = useState<AcordoRateioRecord>(() => {
    const found = activeAcordoId ? acordos.find((a) => a.id === activeAcordoId) : acordos[0];
    return found ? JSON.parse(JSON.stringify(found)) : createBlankAcordoRecord({ referencia: proposalReference || '' });
  });

  const [activeTab, setActiveTab] = useState<'geral' | 'parcelas' | 'cargos' | 'especialista'>('geral');
  const [editingKpi, setEditingKpi] = useState<'valor' | 'taxa' | null>(null);
  const [isEditingTable, setIsEditingTable] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [expandedCargoIdx, setExpandedCargoIdx] = useState<number | null>(null);
  const [activePartySearchIdx, setActivePartySearchIdx] = useState<number | null>(null);
  const [showQuickGen, setShowQuickGen] = useState(false);
  const [quickGen, setQuickGen] = useState({
    valorTotal: '',
    qtdParcelas: '4',
    entradaValor: '',
    primeiroVencimento: new Date().toISOString().slice(0, 10),
    periodicidade: 'MENSAL' as 'MENSAL' | 'SEMESTRAL' | 'ANUAL' | 'UNICA',
  });
  const [printPreviewMode, setPrintPreviewMode] = useState<'rateio' | 'laudo' | 'webropay' | null>(null);
  const [isExportingWebropay, setIsExportingWebropay] = useState(false);
  const [showPagadorPanel, setShowPagadorPanel] = useState(false);
  const printPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);

  // Sync draft when activeAcordoId changes externally
  useEffect(() => {
    if (!activeAcordoId) return;
    const found = acordos.find((a) => a.id === activeAcordoId);
    if (found && found.id !== draft.id) {
      setDraft(JSON.parse(JSON.stringify(found)));
      setIsEditingTable(false);
      setExpandedCargoIdx(null);
    }
  }, [activeAcordoId, acordos, draft.id]);

  // Compute simulation & waterfall dynamically unless manual override is active
  const { simulation, waterfall } = useMemo(() => {
    const sumParcelas = (draft.parcelas || []).reduce((acc, p) => acc + (Number(p.valorTotal) || 0), 0);
    const effectiveBase = draft.valorBaseAcordo > 0 ? draft.valorBaseAcordo : sumParcelas;
    const sim = processarProposta(
      draft.parcelas || [],
      draft.percentualAcordo,
      undefined,
      installmentConfigs,
      draft.modalidade,
      effectiveBase
    );

    if (draft.isManual && draft.manualWaterfall) {
      return { simulation: sim, waterfall: draft.manualWaterfall };
    }

    const wfRaw = calcularRateioCascata(
      effectiveBase,
      draft.percentualAcordo,
      sim.fluxo,
      draft.modalidade,
      draft.participantes
    );
    const wf = obterRateioConsolidado(wfRaw) || wfRaw;
    return { simulation: sim, waterfall: wf };
  }, [draft, installmentConfigs]);

  const diagnostico = useMemo(() => {
    if (!waterfall || waterfall.detalhesParcelas.length === 0) return null;
    return gerarDiagnosticoEspecialista(waterfall);
  }, [waterfall]);

  const sumCargosBase = useMemo(
    () => draft.participantes.reduce((acc, p) => acc + (Number(p.percentage) || 0), 0),
    [draft.participantes]
  );
  const sumCargosPremio = useMemo(
    () => draft.participantes.reduce((acc, p) => acc + (Number(p.taxaPremio) || 0), 0),
    [draft.participantes]
  );
  const sumCargosTotal = Number((sumCargosBase + sumCargosPremio).toFixed(6));
  const hasMismatch = Math.abs(sumCargosTotal - draft.percentualAcordo) > 0.01;
  const hasCoverageShortage = waterfall.saldoRestanteComissao > 0.01;
  const isLiquidada = waterfall.saldoRestanteComissao <= 0.01 && waterfall.comissaoTotal > 0;
  const sumParcelasBruto = useMemo(
    () => (draft.parcelas || []).reduce((acc, p) => acc + (Number(p.valorTotal) || 0), 0),
    [draft.parcelas]
  );

  const findCargoMatchByName = (name: string) => {
    if (!name.trim()) return null;
    const norm = name.trim().toLowerCase();
    return (
      cargos.find(
        (c) =>
          (c.nome || '').trim().toLowerCase() === norm ||
          (c.apelido || '').trim().toLowerCase() === norm
      ) || null
    );
  };

  const getParticipantApelido = (name?: string) => {
    if (!name || !name.trim()) return '';
    const match = findCargoMatchByName(name);
    if (match?.apelido) return match.apelido;
    return name.trim().split(' ')[0];
  };

  const getFilteredPartySuggestions = (rawInput: string) => {
    const parts = (rawInput || '').split(',');
    const lastToken = (parts[parts.length - 1] || '').trim().replace(/^@/, '').toLowerCase();
    if (!lastToken) return cargos.slice(0, 12);
    return cargos
      .filter(
        (c) =>
          (c.nome || '').toLowerCase().includes(lastToken) ||
          (c.apelido || '').toLowerCase().includes(lastToken) ||
          (c.cargo || '').toLowerCase().includes(lastToken)
      )
      .slice(0, 15);
  };

  const selectPartyParticipant = (idx: number, cargoItem: CargoCadastro) => {
    setDraft((prev) => {
      const nextParties = [...prev.participantes];
      const currentName = nextParties[idx].name || '';
      const tokens = currentName.split(',').map((t) => t.trim());
      if (tokens.length > 1) {
        tokens[tokens.length - 1] = cargoItem.nome;
        nextParties[idx] = { ...nextParties[idx], name: tokens.filter(Boolean).join(', ') };
      } else {
        nextParties[idx] = { ...nextParties[idx], name: cargoItem.nome };
      }
      return { ...prev, participantes: nextParties, isManual: false, manualWaterfall: null };
    });
    setActivePartySearchIdx(null);
  };

  const handleRecalculate = () => {
    setIsRecalculating(true);
    setIsEditingTable(false);
    setDraft((prev) => ({
      ...prev,
      isManual: false,
      manualWaterfall: null,
    }));
    setTimeout(() => setIsRecalculating(false), 180);
  };

  const handleSave = async () => {
    if (isReadOnly) return;
    setIsSaving(true);
    try {
      const toSave: AcordoRateioRecord = {
        ...draft,
        titulo: draft.titulo.trim() || 'Rateio de Acordo',
        manualWaterfall: draft.isManual ? waterfall : null,
        updated_at: new Date().toISOString(),
      };
      await onSaveAcordo(toSave);
      setDraft(toSave);
      onSelectAcordoId(toSave.id);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateNew = () => {
    const fresh = createBlankAcordoRecord({ referencia: proposalReference || '' });
    setDraft(fresh);
    onSelectAcordoId(null);
    setIsEditingTable(false);
    setExpandedCargoIdx(null);
    setActiveTab('parcelas');
    showToast('Novo rateio de acordo iniciado.', 'info');
  };

  const handleImportFromProposal = () => {
    if (!proposalPayments || proposalPayments.length === 0) {
      showToast('Nenhuma parcela cadastrada na proposta atual para importar.', 'info');
      return;
    }
    const sumProp = proposalPayments.reduce((acc, p) => acc + (Number(p.valorTotal) || 0), 0);
    const vgv = proposalVgv && proposalVgv > 0 ? proposalVgv : sumProp;
    const pct = proposalCommissionPct && proposalCommissionPct > 0 ? proposalCommissionPct : 100;
    const importedParties: AcordoParticipanteItem[] =
      proposalParties && proposalParties.length > 0
        ? proposalParties.map((p) => ({
            role: p.role,
            name: p.name || '',
            percentage: Number(p.percentage) || 0,
            taxaPremio: Number(p.taxaPremio) || 0,
            deduction: Number(p.deduction) || 0,
            hideAndSum: !!p.hideAndSum,
          }))
        : draft.participantes;

    const extractedPagador = extractPagadorFromProposal(proposal, empreendimentos);

    setDraft((prev) => ({
      ...prev,
      referencia: proposalReference || prev.referencia,
      valorBaseAcordo: vgv,
      percentualAcordo: pct,
      parcelas: proposalPayments.map((p) => ({ ...p })),
      participantes: importedParties,
      linkedProposalId: proposal?.id || prev.linkedProposalId,
      pagador: {
        ...extractedPagador,
        ...(prev.pagador || {}),
        nomeRazaoSocial: extractedPagador.nomeRazaoSocial || prev.pagador?.nomeRazaoSocial || '',
        email: extractedPagador.email || prev.pagador?.email || '',
        cpfCnpj: extractedPagador.cpfCnpj || prev.pagador?.cpfCnpj || '',
        telefone: extractedPagador.telefone || prev.pagador?.telefone || '',
        cep: extractedPagador.cep || prev.pagador?.cep || '',
        endereco: extractedPagador.endereco || prev.pagador?.endereco || '',
        nomeEmpreendimento: extractedPagador.nomeEmpreendimento || prev.pagador?.nomeEmpreendimento || '',
        torreUnidade: extractedPagador.torreUnidade || prev.pagador?.torreUnidade || '',
        tipo: prev.pagador?.tipo || 'Acordo',
        dataVenda: extractedPagador.dataVenda || prev.pagador?.dataVenda || '',
        valorVenda: extractedPagador.valorVenda ?? prev.pagador?.valorVenda ?? vgv,
        idExterno: extractedPagador.idExterno || prev.pagador?.idExterno || prev.id,
      },
      isManual: false,
      manualWaterfall: null,
    }));
    showToast('Parcelas, participantes e dados do pagador importados da proposta atual!', 'success');
  };

  const handleCopyCommissionParties = () => {
    if (!proposalParties || proposalParties.length === 0) {
      showToast('Nenhum cargo configurado no Rateio de Comissões no momento.', 'info');
      return;
    }
    const sumRaw = proposalParties.reduce(
      (acc, p) => acc + (Number(p.percentage) || 0) + (Number(p.taxaPremio) || 0),
      0
    );
    const scaleTo100 = draft.percentualAcordo === 100 && sumRaw > 0 && sumRaw < 99;
    const copied: AcordoParticipanteItem[] = proposalParties.map((p) => {
      const baseP = Number(p.percentage) || 0;
      const premP = Number(p.taxaPremio) || 0;
      return {
        role: p.role,
        name: p.name || '',
        percentage: scaleTo100 ? Number(((baseP / sumRaw) * 100).toFixed(2)) : baseP,
        taxaPremio: scaleTo100 ? Number(((premP / sumRaw) * 100).toFixed(2)) : premP,
        deduction: Number(p.deduction) || 0,
        hideAndSum: !!p.hideAndSum,
      };
    });
    const newTotalPct = Number(
      copied.reduce((acc, p) => acc + (p.percentage || 0) + (p.taxaPremio || 0), 0).toFixed(4)
    );
    setDraft((prev) => ({
      ...prev,
      participantes: copied,
      percentualAcordo: scaleTo100 ? 100 : newTotalPct > 0 ? newTotalPct : prev.percentualAcordo,
      isManual: false,
      manualWaterfall: null,
    }));
    showToast('Cargos e participantes copiados do Rateio de Comissões!', 'success');
  };

  const handleApplyQuickGenerator = (e: React.FormEvent) => {
    e.preventDefault();
    const totalVal =
      Number(
        String(quickGen.valorTotal)
          .replace(/[^\d.,]/g, '')
          .replace(/\./g, '')
          .replace(',', '.')
      ) || draft.valorBaseAcordo;
    const entradaVal =
      Number(
        String(quickGen.entradaValor || '0')
          .replace(/[^\d.,]/g, '')
          .replace(/\./g, '')
          .replace(',', '.')
      ) || 0;
    const qtd = Math.max(1, parseInt(quickGen.qtdParcelas, 10) || 1);
    const startBr = isoToDateBR(quickGen.primeiroVencimento);

    if (totalVal <= 0) {
      showToast('Informe um valor total válido para gerar o parcelamento.', 'error');
      return;
    }

    const newParcelas: PaymentInstallment[] = [];
    let remaining = totalVal;

    if (entradaVal > 0 && entradaVal < totalVal) {
      newParcelas.push({
        quantidade: 1,
        tipo: 'SINAL / ATO',
        valorUnitario: Number(entradaVal.toFixed(2)),
        vencimento: startBr,
        valorTotal: Number(entradaVal.toFixed(2)),
      });
      remaining = Number((totalVal - entradaVal).toFixed(2));
    }

    if (quickGen.periodicidade === 'UNICA' || qtd === 1) {
      newParcelas.push({
        quantidade: 1,
        tipo: entradaVal > 0 ? 'SALDO ÚNICO' : 'PARCELA ÚNICA',
        valorUnitario: Number(remaining.toFixed(2)),
        vencimento: entradaVal > 0 ? addMonthsBR(startBr, 1) : startBr,
        valorTotal: Number(remaining.toFixed(2)),
      });
    } else {
      const tipoLabel =
        quickGen.periodicidade === 'SEMESTRAL'
          ? 'INTERMEDIÁRIA / SEMESTRAL'
          : quickGen.periodicidade === 'ANUAL'
            ? 'ANUAL'
            : 'MENSAL';
      const unitVal = Number((remaining / qtd).toFixed(2));
      newParcelas.push({
        quantidade: qtd,
        tipo: tipoLabel,
        valorUnitario: unitVal,
        vencimento: entradaVal > 0 ? addMonthsBR(startBr, 1) : startBr,
        valorTotal: Number(remaining.toFixed(2)),
      });
    }

    setDraft((prev) => ({
      ...prev,
      valorBaseAcordo: Number(totalVal.toFixed(2)),
      parcelas: newParcelas,
      isManual: false,
      manualWaterfall: null,
    }));
    setShowQuickGen(false);
    showToast('Parcelamento do acordo gerado automaticamente!', 'success');
  };

  // Parcela CRUD
  const addParcela = () => {
    const nextVenc =
      draft.parcelas.length > 0
        ? addMonthsBR(draft.parcelas[draft.parcelas.length - 1].vencimento, 1)
        : formatDateBR(new Date());
    setDraft((prev) => ({
      ...prev,
      parcelas: [
        ...prev.parcelas,
        {
          quantidade: 1,
          tipo: prev.parcelas.length === 0 ? 'SINAL / ATO' : 'MENSAL',
          valorUnitario: 0,
          vencimento: nextVenc,
          valorTotal: 0,
        },
      ],
      isManual: false,
      manualWaterfall: null,
    }));
  };

  const updateParcela = (idx: number, field: keyof PaymentInstallment, value: any) => {
    setDraft((prev) => {
      const next = [...prev.parcelas];
      const item = { ...next[idx], [field]: value };
      if (field === 'quantidade' || field === 'valorUnitario') {
        item.valorTotal = Number(((Number(item.quantidade) || 0) * (Number(item.valorUnitario) || 0)).toFixed(2));
      }
      next[idx] = item;
      const newSum = Number(next.reduce((acc, p) => acc + (Number(p.valorTotal) || 0), 0).toFixed(2));
      return {
        ...prev,
        parcelas: next,
        valorBaseAcordo: prev.percentualAcordo === 100 && newSum > 0 ? newSum : prev.valorBaseAcordo,
        isManual: false,
        manualWaterfall: null,
      };
    });
  };

  const removeParcela = (idx: number) => {
    setDraft((prev) => {
      const next = prev.parcelas.filter((_, i) => i !== idx);
      const newSum = Number(next.reduce((acc, p) => acc + (Number(p.valorTotal) || 0), 0).toFixed(2));
      return {
        ...prev,
        parcelas: next,
        valorBaseAcordo: prev.percentualAcordo === 100 && newSum > 0 ? newSum : prev.valorBaseAcordo,
        isManual: false,
        manualWaterfall: null,
      };
    });
  };

  // Manual Waterfall Cell & Date Editing
  const handleCellEdit = (parcelaIdx: number, partLabel: string, rawVal: string) => {
    const numericVal = Math.max(0, parseFloat(rawVal) || 0);
    const cloned: WaterfallResult = JSON.parse(JSON.stringify(waterfall));
    if (!cloned.detalhesParcelas[parcelaIdx]) return;
    cloned.detalhesParcelas[parcelaIdx].distribuicao[partLabel] = Number(numericVal.toFixed(2));

    // Recompute received & balance per participant
    cloned.participantes.forEach((p) => {
      const lbl = p.name ? `${p.role} - ${p.name}` : p.role;
      const sumRec = cloned.detalhesParcelas.reduce(
        (acc, det) => acc + (Number(det.distribuicao[lbl]) || 0),
        0
      );
      p.received = Number(sumRec.toFixed(2));
      p.balance = Number((p.cap - p.received).toFixed(2));
    });

    const totalDistributed = cloned.participantes.reduce((acc, p) => acc + p.received, 0);
    cloned.saldoRestanteComissao = Number(Math.max(0, cloned.comissaoTotal - totalDistributed).toFixed(2));

    setDraft((prev) => ({
      ...prev,
      isManual: true,
      manualWaterfall: cloned,
    }));
  };

  const handleVencimentoEdit = (parcelaIdx: number, newDate: string) => {
    const cloned: WaterfallResult = JSON.parse(JSON.stringify(waterfall));
    if (!cloned.detalhesParcelas[parcelaIdx]) return;
    cloned.detalhesParcelas[parcelaIdx].vencimento = newDate;
    setDraft((prev) => ({
      ...prev,
      isManual: true,
      manualWaterfall: cloned,
    }));
  };

  // Visible installments (same rule as Rateio de Comissões: stop once total is settled)
  const visibleParcelas = useMemo(() => {
    let runningSum = 0;
    const rows: Array<
      WaterfallResult['detalhesParcelas'][number] & {
        originalIndex: number;
        vencimentoToShow: string;
        valorAcordoToShow: number;
      }
    > = [];

    for (let idx = 0; idx < waterfall.detalhesParcelas.length; idx++) {
      const det = waterfall.detalhesParcelas[idx];
      const simFluxo =
        simulation && idx < simulation.fluxo.length && waterfall.detalhesParcelas.length > 1
          ? simulation.fluxo[idx]
          : null;
      const vencimentoToShow = draft.isManual ? det.vencimento : simFluxo ? simFluxo.vencimento : det.vencimento;
      const valorAcordoToShow = det.valorRetido;

      if (valorAcordoToShow > 0 || (isEditingTable && waterfall.detalhesParcelas.length === 1)) {
        rows.push({
          ...det,
          originalIndex: idx,
          vencimentoToShow,
          valorAcordoToShow,
        });
      }
      runningSum = Number((runningSum + valorAcordoToShow).toFixed(2));
      if (runningSum >= waterfall.comissaoTotal - 0.01 && waterfall.comissaoTotal > 0) {
        break;
      }
    }
    return rows;
  }, [waterfall, simulation, draft.isManual, isEditingTable]);

  // Export CSV (pure numbers per AGENTS.md)
  const handleExportCSV = () => {
    if (visibleParcelas.length === 0) {
      showToast('Não há parcelas no rateio do acordo para exportar.', 'info');
      return;
    }
    const partLabels = waterfall.participantes.map((p) => (p.name ? `${p.role} - ${p.name}` : p.role));
    const headers = ['Vencimento', 'Tipo', 'Parcela_Acordo', ...partLabels];
    const rows = visibleParcelas.map((det) => [
      det.vencimentoToShow,
      `"${(det.tipo || '').replace(/"/g, '""')}"`,
      det.valorAcordoToShow.toFixed(2),
      ...partLabels.map((lbl) => (Number(det.distribuicao[lbl]) || 0).toFixed(2)),
    ]);
    const totalRow = [
      'TOTAL',
      'CONSOLIDADO',
      visibleParcelas.reduce((s, d) => s + d.valorAcordoToShow, 0).toFixed(2),
      ...waterfall.participantes.map((p) => p.received.toFixed(2)),
    ];
    const csv = [headers.join(';'), ...rows.map((r) => r.join(';')), totalRow.join(';')].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = (draft.titulo || 'acordo').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    a.download = `rateio_acordo_${slug}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('CSV do Rateio de Acordo exportado!', 'success');
  };

  // Export .ICS calendar
  const handleExportICS = () => {
    if (visibleParcelas.length === 0) {
      showToast('Não há vencimentos no rateio do acordo para gerar calendário.', 'info');
      return;
    }
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SecVendas//Rateio de Acordo//PT-BR',
      'CALSCALE:GREGORIAN',
    ];
    visibleParcelas.forEach((det, idx) => {
      const m = (det.vencimentoToShow || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const yyyymmdd = m ? `${m[3]}${m[2]}${m[1]}` : new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const breakdown = waterfall.participantes
        .map((p) => {
          const lbl = p.name ? `${p.role} - ${p.name}` : p.role;
          const v = det.distribuicao[lbl] || 0;
          return v > 0 ? `${lbl}: ${formatBRL(v)}` : null;
        })
        .filter(Boolean)
        .join(' | ');
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:acordo-${draft.id}-${idx}@secvendas`);
      lines.push(`DTSTART;VALUE=DATE:${yyyymmdd}`);
      lines.push(`SUMMARY:Rateio Acordo (${draft.titulo}) - Parcela ${idx + 1}: ${formatBRL(det.valorAcordoToShow)}`);
      lines.push(`DESCRIPTION:${(draft.referencia ? draft.referencia + ' - ' : '') + breakdown}`);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');

    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = (draft.titulo || 'acordo').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    a.download = `calendario_acordo_${slug}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Calendário .ICS do Acordo exportado!', 'success');
  };

  // Print Rateio Geral & Laudo Técnico (opens A4 preview modal and triggers reliable print)
  const handlePrintRateio = () => {
    if (visibleParcelas.length === 0) {
      showToast('Cadastre ao menos uma parcela do acordo antes de imprimir o rateio.', 'info');
      return;
    }
    setPrintPreviewMode('rateio');
  };

  const handlePrintLaudo = () => {
    if (!diagnostico || visibleParcelas.length === 0) {
      showToast('Cadastre as parcelas do acordo para gerar e imprimir o Laudo Técnico.', 'info');
      return;
    }
    setPrintPreviewMode('laudo');
  };

  // Auto-resolve linked proposal (explicit link -> savedExtractions match -> open proposal)
  const autoMatchedProposal = useMemo<ExtractionResult | SavedExtraction | null>(() => {
    if (draft.linkedProposalId) {
      const byId = savedExtractions.find((e) => e.id === draft.linkedProposalId);
      if (byId) return byId;
      if (proposal && proposal.id === draft.linkedProposalId) return proposal;
    }

    const searchRef = (draft.referencia || '').trim().toLowerCase();
    const searchTitle = (draft.titulo || '').trim().toLowerCase();
    const matchFromSaved = savedExtractions.find((ext) => {
      const emp = (ext.property?.empreendimento || '').trim().toLowerCase();
      const un = (ext.property?.unidade || '').trim().toLowerCase();
      const cli = ((ext.customers?.[0]?.nome || (ext as any).customer?.nome || '') as string)
        .trim()
        .toLowerCase();
      if (emp && searchRef && searchRef.includes(emp) && (!un || searchRef.includes(un))) {
        return true;
      }
      if (cli && searchTitle && (cli.includes(searchTitle) || searchTitle.includes(cli))) {
        return true;
      }
      if (cli && searchRef && (cli.includes(searchRef) || searchRef.includes(cli))) {
        return true;
      }
      return false;
    });
    if (matchFromSaved) return matchFromSaved;

    return proposal || null;
  }, [draft.linkedProposalId, draft.referencia, draft.titulo, savedExtractions, proposal]);

  const resolvedPagador = useMemo<WebropayPagadorOverride>(() => {
    const autoData = extractPagadorFromProposal(autoMatchedProposal, empreendimentos);
    const manual = draft.pagador || {};

    const firstParcelaDate =
      visibleParcelas[0]?.vencimentoToShow ||
      draft.parcelas?.[0]?.vencimento ||
      formatDateBR(new Date());

    const pickStr = (manualVal?: string, autoVal?: string, fallbackVal = '') => {
      if (manualVal !== undefined) return manualVal;
      if (autoVal !== undefined && autoVal.trim() !== '') return autoVal.trim();
      return fallbackVal.trim();
    };

    const pickNum = (manualVal?: number, autoVal?: number, fallbackVal = 0) => {
      if (typeof manualVal === 'number' && !isNaN(manualVal)) return manualVal;
      if (typeof autoVal === 'number' && !isNaN(autoVal) && autoVal > 0) return autoVal;
      return Number((fallbackVal || 0).toFixed(2));
    };

    return {
      nomeRazaoSocial: pickStr(manual.nomeRazaoSocial, autoData.nomeRazaoSocial),
      email: pickStr(manual.email, autoData.email),
      cpfCnpj: pickStr(manual.cpfCnpj, autoData.cpfCnpj),
      telefone: pickStr(manual.telefone, autoData.telefone),
      cep: pickStr(manual.cep, autoData.cep),
      endereco: pickStr(manual.endereco, autoData.endereco),
      nomeEmpreendimento: pickStr(
        manual.nomeEmpreendimento,
        autoData.nomeEmpreendimento,
        draft.referencia || draft.titulo || ''
      ),
      torreUnidade: pickStr(manual.torreUnidade, autoData.torreUnidade),
      tipo: pickStr(manual.tipo, autoData.tipo, 'Acordo'),
      dataVenda: pickStr(manual.dataVenda, autoData.dataVenda, firstParcelaDate),
      valorVenda: pickNum(manual.valorVenda, autoData.valorVenda, waterfall.vendaTotal),
      valorComissao: pickNum(manual.valorComissao, undefined, waterfall.comissaoTotal),
      idExterno: pickStr(manual.idExterno, autoData.idExterno, draft.id),
    };
  }, [autoMatchedProposal, empreendimentos, draft, visibleParcelas, waterfall]);

  const pagadorFilledCount = useMemo(() => {
    const vals = [
      resolvedPagador.nomeRazaoSocial,
      resolvedPagador.email,
      resolvedPagador.cpfCnpj,
      resolvedPagador.telefone,
      resolvedPagador.cep,
      resolvedPagador.endereco,
      resolvedPagador.nomeEmpreendimento,
      resolvedPagador.torreUnidade,
      resolvedPagador.tipo,
      resolvedPagador.dataVenda,
      resolvedPagador.valorVenda && resolvedPagador.valorVenda > 0 ? 'ok' : '',
      resolvedPagador.valorComissao && resolvedPagador.valorComissao > 0 ? 'ok' : '',
      resolvedPagador.idExterno,
    ];
    return vals.filter((v) => String(v || '').trim() !== '').length;
  }, [resolvedPagador]);

  const updatePagadorField = <K extends keyof AcordoPagadorData>(
    key: K,
    value: AcordoPagadorData[K]
  ) => {
    setDraft((prev) => ({
      ...prev,
      pagador: {
        ...(prev.pagador || {}),
        [key]: value,
      },
    }));
  };

  const handleLoadPagadorFromSavedProposal = (proposalId: string) => {
    if (!proposalId) return;
    const ext =
      proposalId === '__current__'
        ? proposal || null
        : savedExtractions.find((e) => e.id === proposalId) ||
          (proposal && proposal.id === proposalId ? proposal : null);
    if (!ext) return;
    const extracted = extractPagadorFromProposal(ext, empreendimentos);
    setDraft((prev) => ({
      ...prev,
      linkedProposalId: ext.id || (proposalId === '__current__' ? '__current__' : undefined),
      referencia:
        prev.referencia ||
        (ext.property?.empreendimento
          ? `${ext.property.empreendimento}${ext.property.unidade ? ` #${ext.property.unidade}` : ''}`
          : prev.referencia),
      pagador: {
        ...extracted,
        tipo: prev.pagador?.tipo || 'Acordo',
        valorComissao: prev.pagador?.valorComissao,
      },
    }));
    showToast('Dados do pagador importados da proposta selecionada!', 'success');
  };

  const webropayExportOptions = useMemo(() => {
    const slug = (draft.titulo || draft.referencia || 'acordo')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

    const matchedAsResult = autoMatchedProposal as Partial<ExtractionResult> | null;
    const baseProposal: ExtractionResult = autoMatchedProposal
      ? {
          ...autoMatchedProposal,
          id: resolvedPagador.idExterno || draft.id,
          customers: autoMatchedProposal.customers || [],
          salesTeam: matchedAsResult?.salesTeam || {
            corretor1: '',
            corretor2: '',
            gerente: '',
          },
          address: autoMatchedProposal.address || {
            cep: resolvedPagador.cep || '',
            logradouro: resolvedPagador.endereco || '',
            numero: '',
            complemento: '',
            bairro: '',
            cidade: '',
            estado: '',
          },
          property: {
            ...autoMatchedProposal.property,
            empreendimento:
              resolvedPagador.nomeEmpreendimento ||
              autoMatchedProposal.property?.empreendimento ||
              draft.referencia ||
              draft.titulo ||
              '',
            unidade: autoMatchedProposal.property?.unidade || resolvedPagador.torreUnidade || '',
            torre: autoMatchedProposal.property?.torre || '',
          },
          payments: draft.parcelas,
          valorTotalProposta: resolvedPagador.valorVenda || waterfall.vendaTotal,
          validations: matchedAsResult?.validations || {
            cpfMatch: true,
            totalValueMatch: true,
          },
        }
      : {
          id: resolvedPagador.idExterno || draft.id,
          customers: [],
          salesTeam: {
            corretor1: '',
            corretor2: '',
            gerente: '',
          },
          address: {
            cep: resolvedPagador.cep || '',
            logradouro: resolvedPagador.endereco || '',
            numero: '',
            complemento: '',
            bairro: '',
            cidade: '',
            estado: '',
          },
          property: {
            empreendimento: resolvedPagador.nomeEmpreendimento || draft.referencia || draft.titulo || '',
            unidade: resolvedPagador.torreUnidade || '',
            torre: '',
            endereco: resolvedPagador.endereco || '',
          },
          payments: draft.parcelas,
          valorTotalProposta: resolvedPagador.valorVenda || waterfall.vendaTotal,
          validations: {
            cpfMatch: true,
            totalValueMatch: true,
          },
        };

    return {
      proposal: baseProposal,
      waterfall,
      cargos,
      tipoOperacao: resolvedPagador.tipo || 'Acordo',
      customFileName: `webropay_acordo_${slug || 'rateio'}.xlsx`,
      pagadorOverrides: {
        nomeRazaoSocial: (resolvedPagador.nomeRazaoSocial || '').trim(),
        email: (resolvedPagador.email || '').trim(),
        cpfCnpj: (resolvedPagador.cpfCnpj || '').trim(),
        telefone: (resolvedPagador.telefone || '').trim(),
        cep: (resolvedPagador.cep || '').trim(),
        endereco: (resolvedPagador.endereco || '').trim(),
        nomeEmpreendimento: (resolvedPagador.nomeEmpreendimento || '').trim(),
        torreUnidade: (resolvedPagador.torreUnidade || '').trim(),
        tipo: (resolvedPagador.tipo || 'Acordo').trim(),
        dataVenda: (resolvedPagador.dataVenda || '').trim(),
        valorVenda: resolvedPagador.valorVenda,
        valorComissao: resolvedPagador.valorComissao,
        idExterno: (resolvedPagador.idExterno || '').trim(),
      },
      visibleParcelasOverride: visibleParcelas.map((d) => ({
        vencimentoToShow: d.vencimentoToShow,
        valorComissaoToShow: d.valorAcordoToShow,
        distribuicao: d.distribuicao || {},
      })),
    };
  }, [draft, autoMatchedProposal, resolvedPagador, waterfall, cargos, visibleParcelas]);

  const webropaySheetData = useMemo(
    () => buildWebropaySheetData(webropayExportOptions),
    [webropayExportOptions]
  );

  const handlePrintWebropay = () => {
    if (visibleParcelas.length === 0) {
      showToast('Cadastre ao menos uma parcela no acordo para imprimir a Planilha WebroPay.', 'info');
      return;
    }
    setPrintPreviewMode('webropay');
  };

  const handleDownloadWebropayExcel = async () => {
    if (visibleParcelas.length === 0) {
      showToast('Cadastre ao menos uma parcela no acordo antes de exportar a Planilha WebroPay.', 'info');
      return;
    }
    try {
      setIsExportingWebropay(true);
      await generateWebropayExcel(webropayExportOptions);
      showToast('Planilha WebroPay (.xlsx) do acordo gerada com sucesso!', 'success');
    } catch (err: any) {
      console.error('Erro ao exportar Planilha WebroPay do acordo:', err);
      showToast('Erro ao gerar Planilha WebroPay (.xlsx).', 'error');
    } finally {
      setIsExportingWebropay(false);
    }
  };

  // Participant Credentials table (matching Rateio de Comissões)
  const activeCredentialsList = useMemo(() => {
    const list: Array<{ nome: string; apelido: string; cpf: string; creci: string; cargo: string }> = [];
    const visibleParties = draft.participantes.filter((p) => {
      if (p.hideAndSum) return false;
      const rLower = (p.role || '').toLowerCase().trim();
      if (rLower === 'imobiliária' || rLower === 'imobiliaria') return false;
      return p.name && p.name.trim() !== '' && !p.name.includes('___');
    });

    visibleParties.forEach((p) => {
      p.name.split(',').forEach((raw) => {
        const nameTrimmed = raw.trim();
        if (!nameTrimmed) return;
        const existing = list.find((ap) => ap.nome.toLowerCase() === nameTrimmed.toLowerCase());
        if (existing) {
          const roles = existing.cargo.split(',').map((r) => r.trim().toLowerCase());
          if (p.role && !roles.includes(p.role.trim().toLowerCase())) {
            existing.cargo = `${existing.cargo}, ${p.role.trim()}`;
          }
          return;
        }
        const match = findCargoMatchByName(nameTrimmed);
        if (match) {
          list.push({
            nome: match.nome,
            apelido: match.apelido || nameTrimmed.split(' ')[0],
            cpf: match.cpf_cnpj || '-',
            creci: match.creci || '-',
            cargo: p.role || match.cargo,
          });
        } else {
          list.push({
            nome: nameTrimmed,
            apelido: nameTrimmed.split(' ')[0],
            cpf: '-',
            creci: '-',
            cargo: p.role,
          });
        }
      });
    });
    return list;
  }, [draft.participantes, cargos]);

  const currentModalidadeLabel =
    draft.modalidade === 'NF/REPASSE'
      ? 'NF/Repasse'
      : draft.modalidade === 'PAGADORIA INCORPORADOR'
        ? 'Incorporador'
        : 'Pagadoria';

  const printDocumentHtml = useMemo(() => {
    if (!printPreviewMode) return '';
    const esc = escapePrintHtml;
    const generatedAt = new Date().toLocaleString('pt-BR');
    const totalParcelasVisiveis = visibleParcelas.reduce((s, d) => s + d.valorAcordoToShow, 0);
    const totalDistribuido = Math.max(0, waterfall.comissaoTotal - waterfall.saldoRestanteComissao);

    const partHeaders = waterfall.participantes
      .map((p) => {
        const ap = getParticipantApelido(p.name);
        return `<th class="right">${esc(p.role)}${
          ap ? `<div class="th-sub">${esc(ap)}</div>` : ''
        }</th>`;
      })
      .join('');

    const matrixBodyRows = visibleParcelas
      .map((det, idx) => {
        const cols = waterfall.participantes
          .map((p) => {
            const lbl = p.name ? `${p.role} - ${p.name}` : p.role;
            const v = det.distribuicao[lbl] || 0;
            return `<td class="mono right">${v > 0 ? esc(formatBRL(v)) : '-'}</td>`;
          })
          .join('');
        return `<tr>
          <td class="mono center">${String(idx + 1).padStart(2, '0')}</td>
          <td class="mono center">${esc(det.vencimentoToShow)}</td>
          <td>${esc(det.tipo || 'Parcela')}</td>
          <td class="mono right bold indigo">${esc(formatBRL(det.valorAcordoToShow))}</td>
          ${cols}
        </tr>`;
      })
      .join('');

    const matrixTotalCols = waterfall.participantes
      .map((p) => `<td class="mono right bold">${esc(formatBRL(p.received))}</td>`)
      .join('');

    const credRows =
      activeCredentialsList.length > 0
        ? activeCredentialsList
            .map(
              (c) => `<tr>
                <td class="bold">${esc(c.nome)}</td>
                <td>${esc(c.apelido)}</td>
                <td class="mono">${esc(c.cpf)}</td>
                <td class="mono">${esc(c.creci)}</td>
                <td>${esc(c.cargo)}</td>
              </tr>`
            )
            .join('')
        : `<tr><td colspan="5" class="center muted">Nenhum participante nomeado vinculado a este acordo.</td></tr>`;

    const sharedStyles = `
      @page { size: A4 landscape; margin: 10mm; }
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        color: #0f172a;
        background: #ffffff;
        margin: 0;
        padding: 14px;
        font-size: 9.5px;
        line-height: 1.38;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .doc-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        border-bottom: 2px solid #0f172a;
        padding-bottom: 8px;
        margin-bottom: 10px;
        gap: 12px;
      }
      .doc-title {
        font-size: 14px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        margin: 0 0 2px 0;
      }
      .doc-sub {
        font-size: 9.5px;
        color: #475569;
        margin: 0;
      }
      .doc-meta {
        text-align: right;
        font-size: 8.5px;
        color: #334155;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .info-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 6px;
        margin-bottom: 12px;
        padding: 7px 9px;
        border: 1px solid #0f172a;
        background: #f8fafc;
      }
      .info-item { display: flex; flex-direction: column; min-width: 0; }
      .info-label {
        font-size: 7.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #475569;
      }
      .info-val {
        font-size: 9.5px;
        font-weight: 800;
        color: #0f172a;
        margin-top: 2px;
      }
      h2 {
        font-size: 10.5px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        margin: 14px 0 6px 0;
        padding-bottom: 3px;
        border-bottom: 1px solid #0f172a;
        page-break-after: avoid;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 4px;
        border: 1px solid #0f172a;
      }
      th, td {
        border: 1px solid #0f172a;
        padding: 4.5px 6px;
        vertical-align: middle;
        font-size: 8.5px;
      }
      th {
        background: #e2e8f0;
        font-weight: 800;
        text-transform: uppercase;
        text-align: left;
      }
      .th-sub {
        font-weight: 500;
        text-transform: none;
        color: #334155;
        font-size: 8px;
        margin-top: 1px;
      }
      tfoot td {
        background: #f1f5f9;
        border-top: 2px solid #0f172a;
        font-weight: 800;
      }
      tr { page-break-inside: avoid; break-inside: avoid; }
      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-variant-numeric: tabular-nums;
      }
      .right { text-align: right; }
      .center { text-align: center; }
      .bold { font-weight: 700; }
      .indigo { color: #3730a3; }
      .emerald { color: #047857; }
      .danger { color: #b91c1c; }
      .muted { color: #64748b; font-style: italic; }
      .summary-row {
        display: flex;
        justify-content: flex-end;
        gap: 20px;
        margin-top: 12px;
        padding-top: 8px;
        border-top: 2px solid #0f172a;
        page-break-inside: avoid;
      }
      .summary-item { text-align: right; }
      .summary-label {
        font-size: 7.5px;
        font-weight: 700;
        text-transform: uppercase;
        color: #475569;
      }
      .summary-val {
        font-size: 11px;
        font-weight: 800;
        margin-top: 1px;
      }
      .obs-box {
        margin-top: 10px;
        padding: 7px 9px;
        border: 1px solid #94a3b8;
        background: #f8fafc;
        font-size: 9px;
      }
      .sig-grid {
        margin-top: 24px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 32px;
        page-break-inside: avoid;
      }
      .sig-box {
        border-top: 1px solid #0f172a;
        padding-top: 4px;
        text-align: center;
        font-size: 8.5px;
        color: #334155;
      }
      .inflex-list {
        margin: 6px 0 0 0;
        padding-left: 16px;
        font-size: 9px;
      }
      .inflex-list li { margin-bottom: 4px; }
      .section-block { margin-bottom: 12px; }
      .webropay-banner {
        background: #1e293b;
        color: #ffffff;
        font-weight: 800;
        text-transform: uppercase;
        text-align: center;
        letter-spacing: 0.04em;
        font-size: 9.5px;
      }
      .webropay-subth {
        background: #f1f5f9;
        color: #334155;
        font-weight: 700;
      }
      .pagador-label {
        background: #f8fafc;
        font-weight: 700;
        color: #334155;
        width: 18%;
      }
      .pagador-val {
        color: #0f172a;
        width: 32%;
      }
    `;

    if (printPreviewMode === 'webropay') {
      const chunkSize = 8;
      const totalChunks = Math.max(1, Math.ceil(webropaySheetData.parcelas.length / chunkSize));

      const beneficiariosTablesHtml = Array.from({ length: totalChunks }, (_, chunkIdx) => {
        const startIdx = chunkIdx * chunkSize;
        const endIdx = Math.min(webropaySheetData.parcelas.length, startIdx + chunkSize);
        const sliceParcelas = webropaySheetData.parcelas.slice(startIdx, endIdx);
        const isLastChunk = chunkIdx === totalChunks - 1;
        const totalColsCount = 2 + sliceParcelas.length + (isLastChunk ? 1 : 0);

        const parcelaNumHeaders = sliceParcelas
          .map((p) => `<th class="center webropay-subth">Parcela ${p.numero}</th>`)
          .join('');
        const parcelaDateHeaders = sliceParcelas
          .map((p) => `<th class="center mono">${esc(p.vencimento)}</th>`)
          .join('');

        const bodyRowsHtml = webropaySheetData.beneficiarios
          .map((b) => {
            const cells = sliceParcelas
              .map((_, i) => {
                const v = b.parcelas[startIdx + i] || 0;
                return `<td class="mono right">${v > 0 ? esc(formatBRL(v)) : '-'}</td>`;
              })
              .join('');
            return `<tr>
              <td class="bold">${esc(b.nomeComissionado)}</td>
              <td class="mono center">${esc(b.cpfCnpj || '-')}</td>
              ${cells}
              ${isLastChunk ? `<td class="mono right bold emerald">${esc(formatBRL(b.total))}</td>` : ''}
            </tr>`;
          })
          .join('');

        const footCells = sliceParcelas
          .map((_, i) => `<td class="mono right bold indigo">${esc(formatBRL(webropaySheetData.totaisPorParcela[startIdx + i] || 0))}</td>`)
          .join('');

        return `
          <div class="section-block">
            <h2>Aba 1: Beneficiários — Rateio das Comissões${
              totalChunks > 1 ? ` (Parcelas ${startIdx + 1} a ${endIdx} de ${webropaySheetData.parcelas.length})` : ''
            }</h2>
            <table>
              <thead>
                <tr>
                  <th colspan="${totalColsCount}" class="webropay-banner">RATEIO DAS COMISSÕES — MODELO WEBROPAY</th>
                </tr>
                <tr>
                  <th rowspan="2" style="width:24%;">Nome do Comissionado</th>
                  <th rowspan="2" class="center" style="width:14%;">CPF / CNPJ</th>
                  ${parcelaNumHeaders}
                  ${isLastChunk ? '<th rowspan="2" class="right" style="width:11%;">Total</th>' : ''}
                </tr>
                <tr>
                  ${parcelaDateHeaders}
                </tr>
              </thead>
              <tbody>${bodyRowsHtml}</tbody>
              <tfoot>
                <tr>
                  <td class="bold">TOTAL CONFERÊNCIA</td>
                  <td class="center mono">${webropaySheetData.beneficiarios.length} benef.</td>
                  ${footCells}
                  ${
                    isLastChunk
                      ? `<td class="mono right bold emerald">${esc(formatBRL(webropaySheetData.totalGeralDistribuido))}</td>`
                      : ''
                  }
                </tr>
              </tfoot>
            </table>
          </div>
        `;
      }).join('');

      const half = Math.ceil(webropaySheetData.pagadorFields.length / 2);
      const pagadorRowsHtml = Array.from({ length: half }, (_, i) => {
        const left = webropaySheetData.pagadorFields[i];
        const right = webropaySheetData.pagadorFields[i + half];
        return `<tr>
          <td class="pagador-label">${esc(left?.label || '')}</td>
          <td class="pagador-val ${left?.isNumeric ? 'mono bold' : ''}">${esc(left?.displayValue || '')}</td>
          <td class="pagador-label">${esc(right?.label || '')}</td>
          <td class="pagador-val ${right?.isNumeric ? 'mono bold' : ''}">${esc(right?.displayValue || '')}</td>
        </tr>`;
      }).join('');

      return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Planilha WebroPay — Rateio de Acordo — ${esc(draft.titulo)}</title>
  <style>${sharedStyles}</style>
</head>
<body>
  <div class="doc-header">
    <div style="display:flex;align-items:center;gap:10px;">
      <img src="${getLogoRjSrc()}" alt="R&J Imóveis" style="height:44px;width:44px;object-fit:contain;flex-shrink:0;" />
      <div>
        <h1 class="doc-title">Planilha WebroPay — Rateio de Acordo</h1>
        <p class="doc-sub">${esc(draft.titulo)}${draft.referencia ? ` • ${esc(draft.referencia)}` : ''} • Espelho para Conferência e Importação WebroPay</p>
      </div>
    </div>
    <div class="doc-meta">
      <div>ACORDO #${esc(draft.id.slice(-4).toUpperCase())}</div>
      <div>Emitido em: ${esc(generatedAt)}</div>
    </div>
  </div>

  ${beneficiariosTablesHtml}

  <div class="section-block">
    <h2>Aba 2: Dados do Pagador (Layout WebroPay)</h2>
    <table>
      <thead>
        <tr>
          <th colspan="4" class="webropay-banner">DADOS DO PAGADOR</th>
        </tr>
      </thead>
      <tbody>${pagadorRowsHtml}</tbody>
    </table>
  </div>

  <div class="sig-grid">
    <div class="sig-box"><strong>Responsável Financeiro / Pagadoria</strong><br/>Conferência WebroPay e Data</div>
    <div class="sig-box"><strong>Diretoria / Validação</strong><br/>Assinatura e Carimbo</div>
  </div>
</body>
</html>`;
    }

    if (printPreviewMode === 'laudo' && diagnostico) {
      const sec1Rows = diagnostico.secaoI.participantes
        .map(
          (p) => `<tr>
            <td class="bold">${esc(p.label)}</td>
            <td class="mono right bold indigo">${esc(formatPctBr(p.aliquotaVGV + (p.taxaPremio || 0)))}%</td>
            <td class="mono right bold">${esc(formatBRL(p.tetoNominal))}</td>
            <td>${esc(p.excecao)}</td>
            <td>${esc(p.tierLabel)}</td>
          </tr>`
        )
        .join('');

      const sec2Rows = diagnostico.secaoII
        .map(
          (row) => `<tr>
            <td class="mono center">${row.linha}</td>
            <td class="mono center">${esc(row.vencimento)}</td>
            <td>${esc(row.tipo)}</td>
            <td class="mono right">${esc(formatBRL(row.parcelaBruta))}</td>
            <td class="mono right bold indigo">${esc(formatBRL(row.deducaoAplicada))}</td>
            <td class="mono right bold emerald">${esc(formatBRL(row.saldoDevedorComissao))}</td>
          </tr>`
        )
        .join('');

      const sec4Rows = diagnostico.secaoIV.inflexoes
        .map(
          (inf) =>
            `<li><strong>${esc(inf.participante)}</strong>: quitado na parcela <strong>${esc(
              inf.parcelaQuitacao
            )}</strong> (${esc(inf.vencimento)}) — Teto nominal atingido: <span class="mono bold">${esc(
              formatBRL(inf.tetoAtingido)
            )}</span></li>`
        )
        .join('');

      return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Laudo Técnico — Rateio de Acordo — ${esc(draft.titulo)}</title>
  <style>${sharedStyles}</style>
</head>
<body>
  <div class="doc-header">
    <div style="display:flex;align-items:center;gap:10px;">
      <img src="${getLogoRjSrc()}" alt="R&J Imóveis" style="height:44px;width:44px;object-fit:contain;flex-shrink:0;" />
      <div>
        <h1 class="doc-title">Laudo Técnico de Auditoria — Rateio de Acordo</h1>
        <p class="doc-sub">${esc(draft.titulo)}${draft.referencia ? ` • ${esc(draft.referencia)}` : ''}</p>
      </div>
    </div>
    <div class="doc-meta">
      <div>ACORDO #${esc(draft.id.slice(-4).toUpperCase())}</div>
      <div>Emitido em: ${esc(generatedAt)}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-item">
      <span class="info-label">Valor Base do Acordo</span>
      <span class="info-val mono">${esc(formatBRL(waterfall.vendaTotal))}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Rateio Global</span>
      <span class="info-val mono">${esc(formatPctBr(draft.percentualAcordo))}% (${esc(formatBRL(waterfall.comissaoTotal))})</span>
    </div>
    <div class="info-item">
      <span class="info-label">Modalidade</span>
      <span class="info-val">${esc(currentModalidadeLabel)}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Parcelas no Fluxo</span>
      <span class="info-val mono">${visibleParcelas.length}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Alíquotas</span>
      <span class="info-val ${diagnostico.secaoI.consistenciaAliquotas ? 'emerald' : 'danger'}">${
        diagnostico.secaoI.consistenciaAliquotas ? 'CONCILIADAS' : 'DIVERGENTE'
      }</span>
    </div>
    <div class="info-item">
      <span class="info-label">Conciliação Final</span>
      <span class="info-val ${isLiquidada ? 'emerald' : 'danger'}">${esc(diagnostico.secaoIII.statusConciliacao)}</span>
    </div>
  </div>

  <div class="section-block">
    <h2>Seção I — Memória de Cálculo e Parâmetros de Entrada</h2>
    <table>
      <thead>
        <tr>
          <th>Participante</th>
          <th class="right" style="width:90px;">Alíquota</th>
          <th class="right" style="width:120px;">Teto Nominal</th>
          <th>Regra / Exceção</th>
          <th>Hierarquia</th>
        </tr>
      </thead>
      <tbody>${sec1Rows}</tbody>
    </table>
  </div>

  <div class="section-block">
    <h2>Seção II — Amortização do Fluxo de Parcelas do Acordo</h2>
    <table>
      <thead>
        <tr>
          <th class="center" style="width:36px;">#</th>
          <th class="center" style="width:86px;">Vencimento</th>
          <th>Tipo</th>
          <th class="right" style="width:115px;">Parcela Bruta</th>
          <th class="right" style="width:115px;">Dedução Aplicada</th>
          <th class="right" style="width:120px;">Saldo Residual</th>
        </tr>
      </thead>
      <tbody>${sec2Rows}</tbody>
    </table>
  </div>

  <div class="section-block">
    <h2>Seção III — Matriz Definitiva de Repasse (Vencimento a Vencimento)</h2>
    <table>
      <thead>
        <tr>
          <th class="center" style="width:32px;">#</th>
          <th class="center" style="width:82px;">Vencimento</th>
          <th style="width:115px;">Tipo</th>
          <th class="right" style="width:105px;">Parcela Acordo</th>
          ${partHeaders}
        </tr>
      </thead>
      <tbody>${matrixBodyRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="bold">TOTAL (${isLiquidada ? '100% LIQUIDADO' : 'PARCIAL'})</td>
          <td class="mono right bold indigo">${esc(formatBRL(totalParcelasVisiveis))}</td>
          ${matrixTotalCols}
        </tr>
      </tfoot>
    </table>
  </div>

  <div class="section-block">
    <h2>Seção IV — Diagnóstico de Eventos Críticos (Inflexões &amp; Quitação)</h2>
    <ul class="inflex-list">${sec4Rows || '<li>Sem inflexões de quitação registradas.</li>'}</ul>
    ${
      diagnostico.secaoIV.liberacaoFluxoIntegral
        ? `<div class="obs-box"><strong>Quitação Integral:</strong> ${esc(
            diagnostico.secaoIV.liberacaoFluxoIntegral.parcela
          )} em <strong>${esc(
            diagnostico.secaoIV.liberacaoFluxoIntegral.vencimento
          )}</strong> — Passivo 100% liquidado com saldo residual zero.</div>`
        : ''
    }
  </div>

  <div class="sig-grid">
    <div class="sig-box"><strong>Responsável Financeiro / Auditoria</strong><br/>Assinatura e Data</div>
    <div class="sig-box"><strong>Diretoria / Conferência</strong><br/>Assinatura e Carimbo</div>
  </div>
</body>
</html>`;
    }

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Tabela de Rateio Geral do Acordo — ${esc(draft.titulo)}</title>
  <style>${sharedStyles}</style>
</head>
<body>
  <div class="doc-header">
    <div style="display:flex;align-items:center;gap:10px;">
      <img src="${getLogoRjSrc()}" alt="R&J Imóveis" style="height:44px;width:44px;object-fit:contain;flex-shrink:0;" />
      <div>
        <h1 class="doc-title">Tabela de Rateio Geral do Acordo</h1>
        <p class="doc-sub">${esc(draft.titulo)} • Demonstrativo Cronológico de Distribuição (Auditoria de Fluxo)</p>
      </div>
    </div>
    <div class="doc-meta">
      <div>ACORDO #${esc(draft.id.slice(-4).toUpperCase())}</div>
      <div>Gerado em: ${esc(generatedAt)}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-item">
      <span class="info-label">Referência / Imóvel</span>
      <span class="info-val">${esc(draft.referencia || 'Não informada')}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Modalidade</span>
      <span class="info-val">${esc(currentModalidadeLabel)}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Valor Base do Acordo</span>
      <span class="info-val mono">${esc(formatBRL(waterfall.vendaTotal))}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Rateio Global</span>
      <span class="info-val mono">${esc(formatPctBr(draft.percentualAcordo))}% (${esc(formatBRL(waterfall.comissaoTotal))})</span>
    </div>
    <div class="info-item">
      <span class="info-label">Parcelas no Rateio</span>
      <span class="info-val mono">${visibleParcelas.length} parcela(s)</span>
    </div>
    <div class="info-item">
      <span class="info-label">Status de Liquidação</span>
      <span class="info-val ${isLiquidada ? 'emerald' : 'danger'}">${isLiquidada ? '100% LIQUIDADO' : 'EM ABERTO'}</span>
    </div>
  </div>

  <div class="section-block">
    <h2>Cronograma Vencimento a Vencimento</h2>
    <table>
      <thead>
        <tr>
          <th class="center" style="width:32px;">#</th>
          <th class="center" style="width:82px;">Vencimento</th>
          <th style="width:115px;">Tipo</th>
          <th class="right" style="width:105px;">Parcela Acordo</th>
          ${partHeaders}
        </tr>
      </thead>
      <tbody>${matrixBodyRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="bold">TOTAL (${isLiquidada ? '100% LIQUIDADO' : 'PARCIAL'})</td>
          <td class="mono right bold indigo">${esc(formatBRL(totalParcelasVisiveis))}</td>
          ${matrixTotalCols}
        </tr>
      </tfoot>
    </table>
  </div>

  <div class="section-block">
    <h2>Credenciais dos Participantes no Acordo</h2>
    <table>
      <thead>
        <tr>
          <th>Nome</th>
          <th>Apelido</th>
          <th style="width:130px;">CPF / CNPJ</th>
          <th style="width:110px;">CRECI</th>
          <th>Cargo na Operação</th>
        </tr>
      </thead>
      <tbody>${credRows}</tbody>
    </table>
  </div>

  ${
    draft.observacao?.trim()
      ? `<div class="obs-box"><strong>Observações:</strong> ${esc(draft.observacao.trim())}</div>`
      : ''
  }

  <div class="summary-row">
    <div class="summary-item">
      <div class="summary-label">Total Acordo Distribuído</div>
      <div class="summary-val mono emerald">${esc(formatBRL(totalDistribuido))}</div>
    </div>
    <div class="summary-item">
      <div class="summary-label">Saldo Remanescente Sem Cobertura</div>
      <div class="summary-val mono ${waterfall.saldoRestanteComissao > 0.01 ? 'danger' : ''}">${esc(
        formatBRL(waterfall.saldoRestanteComissao)
      )}</div>
    </div>
  </div>

  <div class="sig-grid">
    <div class="sig-box"><strong>Responsável Financeiro / Imobiliária</strong><br/>Assinatura e Data</div>
    <div class="sig-box"><strong>Conferência / Diretoria</strong><br/>Assinatura e Carimbo</div>
  </div>
</body>
</html>`;
  }, [
    printPreviewMode,
    draft,
    waterfall,
    visibleParcelas,
    activeCredentialsList,
    diagnostico,
    isLiquidada,
    currentModalidadeLabel,
    cargos,
    webropaySheetData,
  ]);

  const handleDownloadPrintPdf = () => {
    if (printPreviewMode === 'webropay') {
      try {
        generateWebropayPdf({
          title: draft.titulo || 'Rateio de Acordo',
          subtitle: `${draft.referencia ? `${draft.referencia} • ` : ''}Espelho Planilha WebroPay (Beneficiários e Dados do Pagador)`,
          acordoCode: `ACORDO #${draft.id.slice(-4).toUpperCase()}`,
          parcelas: webropaySheetData.parcelas,
          beneficiarios: webropaySheetData.beneficiarios,
          totaisPorParcela: webropaySheetData.totaisPorParcela,
          totalGeralDistribuido: webropaySheetData.totalGeralDistribuido,
          pagadorFields: webropaySheetData.pagadorFields,
          filenamePrefix: 'planilha_webropay_acordo',
        });
        showToast('PDF A4 da Planilha WebroPay baixado com sucesso!', 'success');
      } catch (err) {
        console.error('Erro ao gerar PDF da Planilha WebroPay:', err);
        showToast('Erro ao gerar PDF. Tente baixar o arquivo HTML ou Excel.', 'error');
      }
      return;
    }

    const mode = printPreviewMode === 'laudo' ? 'laudo' : 'rateio';
    try {
      generateRateioPdf({
        mode,
        title: draft.titulo || 'Rateio de Acordo',
        subtitle: `ACORDO #${draft.id.slice(-4).toUpperCase()} • Demonstrativo Cronológico de Distribuição`,
        reference: draft.referencia || 'Não informada',
        modalidade: currentModalidadeLabel,
        percentualGlobal: draft.percentualAcordo,
        waterfall,
        visibleRows: visibleParcelas.map((d) => ({
          vencimento: d.vencimentoToShow,
          tipo: d.tipo || 'Parcela',
          valorParcela: d.valorAcordoToShow,
          distribuicao: d.distribuicao || {},
        })),
        credentials: activeCredentialsList,
        diagnostico,
        observacao: draft.observacao,
        filenamePrefix: 'rateio_acordo',
      });
      showToast(
        mode === 'laudo'
          ? 'PDF A4 do Laudo Técnico baixado com sucesso!'
          : 'PDF A4 do Rateio de Acordo baixado com sucesso!',
        'success'
      );
    } catch (err) {
      console.error('Erro ao gerar PDF do rateio de acordo:', err);
      showToast('Erro ao gerar PDF. Tente baixar o arquivo HTML.', 'error');
    }
  };

  const executePrintFromPreview = () => {
    if (!printDocumentHtml) return;
    const res = printHtmlDirect(printDocumentHtml, 'landscape');
    if (!res.triggered || res.likelyBlocked) {
      handleDownloadPrintPdf();
    }
  };

  const handleDownloadPrintHtml = () => {
    if (!printDocumentHtml) return;
    const slug = (draft.titulo || 'acordo').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const prefix =
      printPreviewMode === 'webropay'
        ? 'planilha_webropay_acordo'
        : printPreviewMode === 'laudo'
          ? 'laudo_rateio_acordo'
          : 'rateio_acordo';
    downloadHtmlFile(printDocumentHtml, `${prefix}_${slug}.html`);
    showToast('Documento HTML de impressão exportado!', 'success');
  };

  return (
    <motion.div
      key="rateio-acordo"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className="w-full space-y-5 pb-6"
    >
      {/* Top Contextual Bar */}
      {!compactHeader && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-indigo-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" />
              <span>{backLabel}</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 font-mono text-[11px] font-bold tracking-wide whitespace-nowrap">
              ACORDO #{draft.id.slice(-4).toUpperCase()}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wider uppercase whitespace-nowrap ${
                isLiquidada ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isLiquidada ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              {isLiquidada ? 'QUITADO' : 'EM ABERTO'}
            </span>
          </div>
        </div>
      )}

      {/* Saved Acordos Selector + Quick Actions */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-3 sm:p-4 shadow-[0_1px_3px_rgba(15,23,42,0.03)] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Handshake className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Acordo Selecionado ({acordos.length} salvo{acordos.length === 1 ? '' : 's'})
              </label>
              <select
                value={acordos.some((a) => a.id === draft.id) ? draft.id : '__novo__'}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '__novo__') {
                    handleCreateNew();
                  } else {
                    const target = acordos.find((a) => a.id === val);
                    if (target) {
                      setDraft(JSON.parse(JSON.stringify(target)));
                      onSelectAcordoId(target.id);
                      setIsEditingTable(false);
                    }
                  }
                }}
                className="w-full max-w-md text-xs sm:text-sm font-bold text-slate-900 bg-transparent outline-none cursor-pointer truncate"
              >
                {!acordos.some((a) => a.id === draft.id) && (
                  <option value="__novo__">{draft.titulo || 'Novo Rateio de Acordo'} (Rascunho)</option>
                )}
                {acordos.map((ac) => (
                  <option key={ac.id} value={ac.id}>
                    {ac.titulo} {ac.referencia ? `— ${ac.referencia}` : ''} ({formatBRL(ac.valorBaseAcordo * (ac.percentualAcordo / 100))})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {!isReadOnly && (
              <>
                <button
                  type="button"
                  onClick={handleCreateNew}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Novo Acordo</span>
                </button>
                {proposalPayments && proposalPayments.length > 0 && (
                  <button
                    type="button"
                    onClick={handleImportFromProposal}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                    title="Importar parcelas, VGV e participantes da proposta aberta"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Importar da Proposta</span>
                  </button>
                )}
                {acordos.some((a) => a.id === draft.id) && (
                  <button
                    type="button"
                    onClick={async () => {
                      await onDeleteAcordo(draft.id);
                      const remaining = acordos.filter((a) => a.id !== draft.id);
                      if (remaining.length > 0) {
                        setDraft(JSON.parse(JSON.stringify(remaining[0])));
                        onSelectAcordoId(remaining[0].id);
                      } else {
                        setDraft(createBlankAcordoRecord({ referencia: proposalReference || '' }));
                        onSelectAcordoId(null);
                      }
                    }}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                    title="Excluir este rateio de acordo"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Title / Reference / Modality Row */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-2 border-t border-slate-100">
          <div className="sm:col-span-5">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Título do Acordo
            </label>
            <input
              type="text"
              disabled={isReadOnly}
              value={draft.titulo}
              onChange={(e) => setDraft((prev) => ({ ...prev, titulo: e.target.value }))}
              placeholder="Ex: Acordo Comercial — Res. Alameda #402"
              className="w-full h-9 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-900 focus:bg-white focus:border-indigo-500 outline-none"
            />
          </div>
          <div className="sm:col-span-4">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Empreendimento / Referência
            </label>
            <input
              type="text"
              disabled={isReadOnly}
              value={draft.referencia}
              onChange={(e) => setDraft((prev) => ({ ...prev, referencia: e.target.value }))}
              placeholder="Ex: Residencial Alameda · Un. 402"
              className="w-full h-9 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-800 focus:bg-white focus:border-indigo-500 outline-none"
            />
          </div>
          <div className="sm:col-span-3">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Modalidade
            </label>
            <select
              disabled={isReadOnly}
              value={draft.modalidade}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  modalidade: e.target.value as FormaPagamentoComissao,
                  isManual: false,
                  manualWaterfall: null,
                }))
              }
              className="w-full h-9 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100/80 text-indigo-700 text-[11px] font-bold uppercase tracking-wider border border-indigo-100 outline-none cursor-pointer"
            >
              <option value="PAGADORIA">PAGADORIA (PARCELADO)</option>
              <option value="NF/REPASSE">NF/REPASSE (ÚNICA)</option>
              <option value="PAGADORIA INCORPORADOR">INCORPORADOR</option>
            </select>
          </div>
        </div>

        {/* Collapsible Dados do Pagador (Planilha WebroPay) */}
        <div className="pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowPagadorPanel((prev) => !prev)}
              className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 hover:text-emerald-700 transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Dados do Pagador (Planilha WebroPay)</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                  pagadorFilledCount >= 11
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700'
                }`}
              >
                {pagadorFilledCount}/13 preenchidos
              </span>
              {showPagadorPanel ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            <div className="flex flex-wrap items-center gap-2">
              {resolvedPagador.nomeRazaoSocial && !showPagadorPanel && (
                <span className="text-[11px] text-slate-500 truncate max-w-[260px]">
                  Pagador: <strong className="text-slate-700">{resolvedPagador.nomeRazaoSocial}</strong>
                </span>
              )}
              {!isReadOnly && (savedExtractions.length > 0 || proposal) && (
                <select
                  value={draft.linkedProposalId || ''}
                  onChange={(e) => {
                    handleLoadPagadorFromSavedProposal(e.target.value);
                    setShowPagadorPanel(true);
                  }}
                  className="h-8 px-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 text-emerald-800 text-[11px] font-bold outline-none cursor-pointer max-w-[260px]"
                  title="Carregar automaticamente os dados do pagador a partir de uma proposta salva"
                >
                  <option value="">Importar pagador de proposta...</option>
                  {proposal &&
                    !savedExtractions.some((s) => s.id === proposal.id) && (
                      <option value={proposal.id || '__current__'}>
                        [Proposta Atual] {proposal.customers?.[0]?.nome || 'Cliente'} —{' '}
                        {proposal.property?.empreendimento || 'Imóvel'}
                      </option>
                    )}
                  {savedExtractions.map((ext) => {
                    const cli = ext.customers?.[0]?.nome || (ext as any).customer?.nome || 'Cliente';
                    const emp = ext.property?.empreendimento || 'Empreendimento';
                    const un = ext.property?.unidade ? ` · Un. ${ext.property.unidade}` : '';
                    return (
                      <option key={ext.id} value={ext.id}>
                        {cli} — {emp}
                        {un}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>
          </div>

          {showPagadorPanel && (
            <div className="mt-3 p-3 sm:p-4 rounded-2xl bg-slate-50/90 border border-slate-200/80 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                <div className="sm:col-span-5">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Nome / Razão Social
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    value={resolvedPagador.nomeRazaoSocial || ''}
                    onChange={(e) => updatePagadorField('nomeRazaoSocial', e.target.value)}
                    placeholder="Nome completo ou razão social do pagador"
                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:border-emerald-500 outline-none"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    CPF / CNPJ
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    value={resolvedPagador.cpfCnpj || ''}
                    onChange={(e) => updatePagadorField('cpfCnpj', e.target.value)}
                    placeholder="000.000.000-00"
                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:border-emerald-500 outline-none"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    E-mail
                  </label>
                  <input
                    type="email"
                    disabled={isReadOnly}
                    value={resolvedPagador.email || ''}
                    onChange={(e) => updatePagadorField('email', e.target.value)}
                    placeholder="pagador@email.com"
                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:border-emerald-500 outline-none"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Telefone
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    value={resolvedPagador.telefone || ''}
                    onChange={(e) => updatePagadorField('telefone', e.target.value)}
                    placeholder="(11) 99999-9999"
                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:border-emerald-500 outline-none"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    CEP
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    value={resolvedPagador.cep || ''}
                    onChange={(e) => updatePagadorField('cep', e.target.value)}
                    placeholder="00000-000"
                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:border-emerald-500 outline-none"
                  />
                </div>
                <div className="sm:col-span-7">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Endereço
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    value={resolvedPagador.endereco || ''}
                    onChange={(e) => updatePagadorField('endereco', e.target.value)}
                    placeholder="Logradouro, número, bairro - Cidade/UF"
                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:border-emerald-500 outline-none"
                  />
                </div>

                <div className="sm:col-span-5">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Nome do Empreendimento
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    value={resolvedPagador.nomeEmpreendimento || ''}
                    onChange={(e) => updatePagadorField('nomeEmpreendimento', e.target.value)}
                    placeholder="Nome do empreendimento"
                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:border-emerald-500 outline-none"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Torre / Unidade
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    value={resolvedPagador.torreUnidade || ''}
                    onChange={(e) => updatePagadorField('torreUnidade', e.target.value)}
                    placeholder="Ex: Torre A / Unidade 402"
                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:border-emerald-500 outline-none"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Tipo (WebroPay)
                  </label>
                  <select
                    disabled={isReadOnly}
                    value={resolvedPagador.tipo || 'Acordo'}
                    onChange={(e) => updatePagadorField('tipo', e.target.value)}
                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:border-emerald-500 outline-none cursor-pointer"
                  >
                    {WEBROPAY_TIPOS_OPERACAO.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Data da Venda
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={10}
                    disabled={isReadOnly}
                    value={resolvedPagador.dataVenda || ''}
                    onChange={(e) =>
                      updatePagadorField('dataVenda', formatDateMaskBR(e.target.value))
                    }
                    placeholder="dd/mm/aaaa"
                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:border-emerald-500 outline-none"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Valor da Venda (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={isReadOnly}
                    value={formatCurrencyInput(resolvedPagador.valorVenda)}
                    onChange={(e) =>
                      updatePagadorField('valorVenda', parseCurrencyInput(e.target.value))
                    }
                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-right text-slate-900 focus:border-emerald-500 outline-none"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Valor da Comissão (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={isReadOnly}
                    value={formatCurrencyInput(resolvedPagador.valorComissao)}
                    onChange={(e) =>
                      updatePagadorField('valorComissao', parseCurrencyInput(e.target.value))
                    }
                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-right text-emerald-700 focus:border-emerald-500 outline-none"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    ID Externo
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    value={resolvedPagador.idExterno || ''}
                    onChange={(e) => updatePagadorField('idExterno', e.target.value)}
                    placeholder="Identificador externo"
                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Estes dados preenchem automaticamente a aba <strong>Pagador</strong> da Planilha WebroPay (.xlsx), o PDF e a impressão. Clique em <strong>Salvar Acordo</strong> para mantê-los salvos.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Title Header */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 leading-tight">
            Rateio de Acordo
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 leading-relaxed max-w-2xl">
            Configure o parcelamento do acordo, alíquotas, tetos e distribuição em cascata vencimento a vencimento.
          </p>
        </div>
      </header>

      {/* 2x2 / 4-col Executive Summary KPI Grid (identical to Rateio & Comissões) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: VALOR BASE DO ACORDO */}
        <div className="bg-white border border-slate-200/80 rounded-3xl p-4 shadow-[0_1px_3px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-2">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-500 leading-tight">
              Valor Base do Acordo
            </span>
            <button
              type="button"
              onClick={() => {
                if (sumParcelasBruto > 0) {
                  setDraft((prev) => ({
                    ...prev,
                    valorBaseAcordo: Number(sumParcelasBruto.toFixed(2)),
                    isManual: false,
                    manualWaterfall: null,
                  }));
                }
                handleRecalculate();
              }}
              className="p-1 -m-1 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer shrink-0"
              title="Sincronizar valor base com o somatório das parcelas"
            >
              <RefreshCw className={`w-4 h-4 ${isRecalculating ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {editingKpi === 'valor' && !isReadOnly ? (
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold text-slate-400">R$</span>
              <input
                type="number"
                step="0.01"
                autoFocus
                value={draft.valorBaseAcordo || 0}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  setDraft((prev) => ({
                    ...prev,
                    valorBaseAcordo: val,
                    isManual: false,
                    manualWaterfall: null,
                  }));
                }}
                onBlur={() => setEditingKpi(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setEditingKpi(null);
                }}
                className="w-full text-base font-extrabold font-mono text-slate-900 bg-slate-50 border border-indigo-200 rounded-lg px-2 py-1 outline-none"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => !isReadOnly && setEditingKpi('valor')}
              className="text-left group cursor-pointer"
              title="Clique para editar o valor base do acordo"
            >
              <div className="text-lg sm:text-xl font-extrabold text-slate-900 font-mono tabular-nums tracking-tight group-hover:text-indigo-600 transition-colors truncate">
                {formatBRL(draft.valorBaseAcordo)}
              </div>
            </button>
          )}

          <p className="text-[11px] font-medium text-slate-500 truncate">
            Parcelas: {formatBRL(sumParcelasBruto)}
          </p>
        </div>

        {/* Card 2: TOTAL DO RATEIO (ALÍQUOTA GLOBAL) */}
        <div className="bg-white border border-slate-200/80 rounded-3xl p-4 shadow-[0_1px_3px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-2">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-500 leading-tight">
              Rateio Global
            </span>
            <button
              type="button"
              onClick={() => !isReadOnly && setEditingKpi((prev) => (prev === 'taxa' ? null : 'taxa'))}
              className="p-1 -m-1 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer shrink-0"
              title="Editar percentual global do rateio (100% para acordo integral ou taxa personalizada)"
            >
              <PieChart className="w-4 h-4" />
            </button>
          </div>

          {editingKpi === 'taxa' && !isReadOnly ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="any"
                min="0"
                autoFocus
                value={draft.percentualAcordo}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  setDraft((prev) => ({
                    ...prev,
                    percentualAcordo: val,
                    isManual: false,
                    manualWaterfall: null,
                  }));
                }}
                onBlur={() => setEditingKpi(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setEditingKpi(null);
                }}
                className="w-24 text-sm font-bold font-mono text-indigo-700 bg-indigo-50/70 border border-indigo-200 rounded-lg px-2 py-1 outline-none"
              />
              <span className="text-xs font-bold text-slate-500">%</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => !isReadOnly && setEditingKpi('taxa')}
              className="text-left group cursor-pointer"
              title="Clique para editar o percentual global"
            >
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="text-lg sm:text-xl font-extrabold text-slate-900 font-mono tabular-nums tracking-tight group-hover:text-indigo-600 transition-colors">
                  {formatPctBr(draft.percentualAcordo)}%
                </span>
                <span className="text-xs font-medium text-slate-500 font-mono tabular-nums truncate">
                  ({formatBRL(waterfall.comissaoTotal)})
                </span>
              </div>
            </button>
          )}

          <p className="text-[11px] font-medium text-slate-500 truncate">
            Base {formatPctBr(sumCargosBase, 1)}% + Prêmio {formatPctBr(sumCargosPremio, 1)}%
          </p>
        </div>

        {/* Card 3: COBERTURA */}
        <div className="bg-white border border-slate-200/80 rounded-3xl p-4 shadow-[0_1px_3px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-2">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-500 leading-tight">
              Cobertura
            </span>
            <ShieldCheck
              className={`w-4 h-4 shrink-0 ${hasCoverageShortage ? 'text-amber-500' : 'text-emerald-600'}`}
            />
          </div>

          <div
            className={`text-lg sm:text-xl font-extrabold font-mono tabular-nums tracking-tight truncate ${
              hasCoverageShortage ? 'text-amber-600' : 'text-emerald-600'
            }`}
          >
            {formatBRL(waterfall.saldoRestanteComissao)}
          </div>

          <p className="text-[11px] font-medium text-slate-500 truncate">
            {hasCoverageShortage ? 'Saldo sem cobertura' : '100% Equalizado'}
          </p>
        </div>

        {/* Card 4: OPERAÇÃO */}
        <div className="bg-white border border-slate-200/80 rounded-3xl p-4 shadow-[0_1px_3px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-2">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-500 leading-tight">
              Operação
            </span>
            <Wallet className="w-4 h-4 text-indigo-600 shrink-0" />
          </div>

          <div className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight truncate">
            {isLiquidada ? 'Liquidada' : 'Em Aberto'}
          </div>

          <p className="text-[11px] font-medium text-slate-500 truncate">
            {visibleParcelas.length} parcela{visibleParcelas.length === 1 ? '' : 's'} · {currentModalidadeLabel}
          </p>
        </div>
      </section>

      {/* Dynamic Alert Panel */}
      {(hasMismatch || hasCoverageShortage || draft.isManual) && (
        <div className="space-y-2.5">
          {draft.isManual && (
            <div className="bg-blue-50/90 border border-blue-200/80 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-slate-700 leading-relaxed">
                  <strong className="text-slate-900">Edição Manual Ativa:</strong> Os repasses deste acordo foram ajustados manualmente.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRecalculate}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[11px] font-bold transition-colors shrink-0 cursor-pointer"
              >
                Restaurar Automático
              </button>
            </div>
          )}

          {hasMismatch && (
            <div className="bg-red-50/90 border border-red-200/80 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-800 leading-relaxed">
                  Soma Base (<strong>{formatPctBr(sumCargosBase)}%</strong>) + Prêmio (
                  <strong>{formatPctBr(sumCargosPremio)}%</strong>) ={' '}
                  <strong>{formatPctBr(sumCargosTotal)}%</strong> diverge do Rateio Global (
                  <strong>{formatPctBr(draft.percentualAcordo)}%</strong>).
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    percentualAcordo: Number(sumCargosTotal.toFixed(6)),
                    isManual: false,
                    manualWaterfall: null,
                  }))
                }
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[11px] font-bold transition-colors shrink-0 cursor-pointer"
              >
                Sincronizar ({formatPctBr(sumCargosTotal)}%)
              </button>
            </div>
          )}

          {hasCoverageShortage && (
            <div className="bg-amber-50/90 border border-amber-200/80 rounded-2xl p-3.5 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 leading-relaxed">
                O fluxo de parcelas do acordo se encerrou com saldo de{' '}
                <strong>{formatBRL(waterfall.saldoRestanteComissao)}</strong> sem cobertura. Ajuste as parcelas na aba <strong>Parcelamento</strong>.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Segmented 4-Tab Pill Navigation */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-slate-100/90 border border-slate-200/70 rounded-2xl">
        {(
          [
            { id: 'parcelas', label: `Parcelamento (${draft.parcelas.length})` },
            { id: 'cargos', label: `Lista de Cargos (${draft.participantes.length})` },
            { id: 'geral', label: 'Rateio Geral' },
            { id: 'especialista', label: 'Laudo Técnico' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`py-2 px-2 sm:px-3 rounded-xl text-xs sm:text-[13px] transition-all cursor-pointer truncate ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 font-bold shadow-xs'
                : 'text-slate-600 font-medium hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200/80 rounded-2xl p-2.5 sm:px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {!isReadOnly && (
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-colors cursor-pointer ${
                saveSuccess ? 'bg-emerald-600' : 'bg-indigo-600 hover:bg-indigo-700'
              } disabled:opacity-60`}
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : saveSuccess ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>{isSaving ? 'Salvando...' : saveSuccess ? 'Salvo' : 'Salvar Acordo'}</span>
            </button>
          )}
          {activeTab === 'geral' && !isReadOnly && (
            <button
              type="button"
              onClick={() => setIsEditingTable((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                isEditingTable
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span>{isEditingTable ? 'Concluir Edição' : 'Editar Rateio'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleRecalculate}
            disabled={isRecalculating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRecalculating ? 'animate-spin' : ''}`} />
            <span>Recalcular</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {onOpenNovacaoPrint && (
            <>
              <button
                type="button"
                onClick={() => onOpenNovacaoPrint(draft, 'novacao')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[#eef0ff] hover:bg-[#e3e6ff] border border-[#c7c2ff] text-[#4338ca] rounded-xl text-xs font-bold transition-colors cursor-pointer"
                title="Abrir minuta padrão do Termo de Novação e Confissão de Dívida"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Imprimir Novação</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenNovacaoPrint(draft, 'confissao')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                title="Abrir Instrumento Particular de Confissão de Dívida e Parcelamento"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Confissão de Dívida</span>
              </button>
            </>
          )}
          {activeTab === 'especialista' ? (
            <>
              <button
                type="button"
                onClick={handlePrintLaudo}
                disabled={!diagnostico}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Imprimir Laudo</span>
              </button>
              <button
                type="button"
                onClick={handlePrintWebropay}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                title="Visualizar e imprimir o espelho da Planilha WebroPay deste acordo"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Imprimir WebroPay</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadWebropayExcel}
                disabled={isExportingWebropay}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
                title="Baixar Planilha WebroPay em formato Excel (.xlsx)"
              >
                {isExportingWebropay ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                )}
                <span>Baixar WebroPay (.xlsx)</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handlePrintRateio}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                title="Visualizar e imprimir a Tabela de Rateio Geral do Acordo"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Imprimir Rateio</span>
              </button>
              <button
                type="button"
                onClick={handlePrintWebropay}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                title="Visualizar e imprimir o espelho da Planilha WebroPay deste acordo"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Imprimir WebroPay</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadWebropayExcel}
                disabled={isExportingWebropay}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
                title="Baixar Planilha WebroPay em formato Excel (.xlsx)"
              >
                {isExportingWebropay ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                )}
                <span>Baixar WebroPay (.xlsx)</span>
              </button>
              <button
                type="button"
                onClick={handleExportCSV}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={handleExportICS}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                title="Exportar calendário (.ics)"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>.ICS</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* TAB 1: PARCELAMENTO DO ACORDO */}
      {activeTab === 'parcelas' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    Parcelamento do Acordo
                  </h3>
                  <p className="text-xs text-slate-500">
                    Defina o fluxo de parcelas do acordo ou gere automaticamente o cronograma.
                  </p>
                </div>
              </div>

              {!isReadOnly && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setQuickGen((prev) => ({
                        ...prev,
                        valorTotal: formatCurrencyInput(draft.valorBaseAcordo),
                      }));
                      setShowQuickGen((prev) => !prev);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Gerador Rápido</span>
                  </button>
                  <button
                    type="button"
                    onClick={addParcela}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Adicionar Parcela</span>
                  </button>
                </div>
              )}
            </div>

            {/* Quick Installment Generator Drawer */}
            {showQuickGen && !isReadOnly && (
              <form
                onSubmit={handleApplyQuickGenerator}
                className="p-4 sm:p-5 bg-indigo-50/50 border-b border-indigo-100 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-900">
                    Gerar Fluxo de Parcelas Automaticamente
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowQuickGen(false)}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Valor Total (R$)
                    </label>
                    <input
                      type="text"
                      required
                      value={quickGen.valorTotal}
                      onChange={(e) => setQuickGen((prev) => ({ ...prev, valorTotal: e.target.value }))}
                      placeholder="14.820,00"
                      className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl font-mono text-xs text-slate-900 outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Entrada / Ato (Opc.)
                    </label>
                    <input
                      type="text"
                      value={quickGen.entradaValor}
                      onChange={(e) => setQuickGen((prev) => ({ ...prev, entradaValor: e.target.value }))}
                      placeholder="0,00"
                      className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl font-mono text-xs text-slate-900 outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Nº de Parcelas
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="120"
                      value={quickGen.qtdParcelas}
                      onChange={(e) => setQuickGen((prev) => ({ ...prev, qtdParcelas: e.target.value }))}
                      className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl font-mono text-xs text-slate-900 outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      1º Vencimento
                    </label>
                    <input
                      type="date"
                      value={quickGen.primeiroVencimento}
                      onChange={(e) =>
                        setQuickGen((prev) => ({ ...prev, primeiroVencimento: e.target.value }))
                      }
                      className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Periodicidade
                    </label>
                    <select
                      value={quickGen.periodicidade}
                      onChange={(e) =>
                        setQuickGen((prev) => ({
                          ...prev,
                          periodicidade: e.target.value as any,
                        }))
                      }
                      className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:border-indigo-500"
                    >
                      <option value="MENSAL">Mensal</option>
                      <option value="SEMESTRAL">Semestral</option>
                      <option value="ANUAL">Anual</option>
                      <option value="UNICA">Parcela Única</option>
                    </select>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowQuickGen(false)}
                    className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-600 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                  >
                    Aplicar Parcelamento
                  </button>
                </div>
              </form>
            )}

            <datalist id="acordo-tipos-parcela">
              <option value="SINAL / ATO" />
              <option value="ENTRADA" />
              <option value="MENSAL" />
              <option value="INTERMEDIÁRIA / SEMESTRAL" />
              <option value="ANUAL" />
              <option value="PARCELA ÚNICA" />
              <option value="SALDO FINAL" />
            </datalist>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[560px]">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200">
                    <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 w-20">
                      Qtd
                    </th>
                    <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 min-w-[160px]">
                      Tipo da Parcela
                    </th>
                    <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-right w-36">
                      Valor Unit. (R$)
                    </th>
                    <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 w-36">
                      1º Vencimento
                    </th>
                    <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-right w-36">
                      Total (R$)
                    </th>
                    {!isReadOnly && (
                      <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center w-14">
                        Ação
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draft.parcelas.length === 0 ? (
                    <tr>
                      <td colSpan={isReadOnly ? 5 : 6} className="p-8 text-center text-xs text-slate-500">
                        Nenhuma parcela definida para este acordo. Clique em <strong>Adicionar Parcela</strong> ou use o <strong>Gerador Rápido</strong>.
                      </td>
                    </tr>
                  ) : (
                    draft.parcelas.map((p, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                        <td className="p-2.5">
                          <input
                            type="number"
                            min={1}
                            disabled={isReadOnly}
                            value={p.quantidade ?? 1}
                            onChange={(e) =>
                              updateParcela(idx, 'quantidade', Math.max(1, parseInt(e.target.value, 10) || 1))
                            }
                            className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono tabular-nums text-slate-900 focus:bg-white focus:border-indigo-500 outline-none"
                          />
                        </td>
                        <td className="p-2.5">
                          <input
                            type="text"
                            list="acordo-tipos-parcela"
                            disabled={isReadOnly}
                            value={p.tipo || ''}
                            onChange={(e) => updateParcela(idx, 'tipo', e.target.value)}
                            placeholder="Ex: Sinal, Mensal, Semestral..."
                            className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:bg-white focus:border-indigo-500 outline-none"
                          />
                        </td>
                        <td className="p-2.5">
                          <input
                            type="text"
                            inputMode="numeric"
                            disabled={isReadOnly}
                            value={formatCurrencyInput(p.valorUnitario)}
                            onChange={(e) =>
                              updateParcela(idx, 'valorUnitario', parseCurrencyInput(e.target.value))
                            }
                            className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono tabular-nums text-right text-slate-900 focus:bg-white focus:border-indigo-500 outline-none"
                          />
                        </td>
                        <td className="p-2.5">
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={10}
                            disabled={isReadOnly}
                            value={p.vencimento || ''}
                            onChange={(e) =>
                              updateParcela(idx, 'vencimento', formatDateMaskBR(e.target.value))
                            }
                            placeholder="dd/mm/aaaa"
                            className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono tabular-nums text-slate-800 focus:bg-white focus:border-indigo-500 outline-none"
                          />
                        </td>
                        <td className="p-2.5 text-right font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums">
                          {formatBRL(p.valorTotal)}
                        </td>
                        {!isReadOnly && (
                          <td className="p-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => removeParcela(idx)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Remover parcela"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-indigo-50/40 border-t border-slate-200 font-bold">
                    <td colSpan={4} className="p-3 text-xs sm:text-sm text-slate-700 text-right">
                      Soma Total das Parcelas do Acordo:
                    </td>
                    <td className="p-3 text-xs sm:text-sm text-indigo-700 font-mono tabular-nums text-right">
                      {formatBRL(sumParcelasBruto)}
                    </td>
                    {!isReadOnly && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setActiveTab('geral')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              <Workflow className="w-4 h-4" />
              <span>Ver Cronograma de Rateio</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: LISTA DE CARGOS E PARTICIPANTES (identical UX to Rateio de Comissões) */}
      {activeTab === 'cargos' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <h3 className="text-base sm:text-lg font-bold text-slate-900">
              Cargos e Participantes do Acordo
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-indigo-600 tabular-nums">
                {draft.participantes.length}{' '}
                {draft.participantes.length === 1 ? 'alocação' : 'alocações'}
              </span>
              {!isReadOnly && proposalParties && proposalParties.length > 0 && (
                <button
                  type="button"
                  onClick={handleCopyCommissionParties}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 text-[11px] font-bold transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar das Comissões</span>
                </button>
              )}
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() => {
                    const nextIdx = draft.participantes.length;
                    setDraft((prev) => ({
                      ...prev,
                      participantes: [
                        ...prev.participantes,
                        { role: 'Novo Cargo', name: '', percentage: 0, taxaPremio: 0, deduction: 0 },
                      ],
                      isManual: false,
                      manualWaterfall: null,
                    }));
                    setExpandedCargoIdx(nextIdx);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Cargo</span>
                </button>
              )}
            </div>
          </div>

          <div className="bg-blue-50/80 border border-blue-100 rounded-2xl px-4 py-3 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-700 leading-relaxed">
              Cargos marcados como <strong className="font-bold text-slate-900">Ocultar</strong> são
              agrupados automaticamente na <strong className="font-bold text-slate-900">Imobiliária</strong>.
              Defina <strong className="font-bold text-slate-900">100% no Ato</strong> para prioridades de quitação antecipada.
            </p>
          </div>

          <div className="space-y-3">
            {draft.participantes.map((p, idx) => {
              const names = p.name ? p.name.split(',').map((n) => n.trim()).filter(Boolean) : [];
              const isHidden = !!p.hideAndSum;
              const roleLower = (p.role || '').toLowerCase().trim();
              const isImob = roleLower === 'imobiliária' || roleLower === 'imobiliaria';
              const isExpanded = expandedCargoIdx === idx;
              const taxaPremioVal = Number(p.taxaPremio) || 0;
              const deductionVal = Number(p.deduction) || 0;
              const hasAssigned = names.length > 0;
              const isAtoFull = p.priorityRule === 'ATO_FULL';

              return (
                <div
                  key={idx}
                  className={`relative bg-white border rounded-3xl p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.03)] transition-all ${
                    hasAssigned
                      ? 'border-slate-200/80 border-l-4 border-l-indigo-600'
                      : isHidden
                        ? 'border-amber-200/80 bg-amber-50/20'
                        : 'border-slate-200/80'
                  }`}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedCargoIdx((prev) => (prev === idx ? null : idx))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpandedCargoIdx((prev) => (prev === idx ? null : idx));
                      }
                    }}
                    className="flex items-start justify-between gap-3 cursor-pointer select-none"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-base sm:text-lg font-bold text-slate-900 leading-snug">
                          {p.role || 'Sem cargo'}
                        </h4>
                        {hasAssigned && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-bold tabular-nums">
                            {names.length} part.
                          </span>
                        )}
                        {isAtoFull && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                            100% no Ato
                          </span>
                        )}
                        {isHidden && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold">
                            <EyeOff className="w-3 h-3" />
                            Oculto
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        {deductionVal > 0
                          ? `Retenção fixa: ${formatPctBr(deductionVal)}% por parcela`
                          : 'Rateio proporcional ao teto'}
                        {taxaPremioVal > 0 ? ` · Prêmio ${formatPctBr(taxaPremioVal)}%` : ''}
                      </p>
                    </div>

                    <div className="flex items-start gap-2 shrink-0 text-right">
                      <div>
                        <div className="text-base sm:text-lg font-extrabold text-slate-900 font-mono tabular-nums leading-tight">
                          {formatPctBr(Number(p.percentage) || 0)}%
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {formatBRL(
                            (draft.valorBaseAcordo *
                              ((Number(p.percentage) || 0) + taxaPremioVal)) /
                              100
                          )}
                        </div>
                      </div>
                      <span className="mt-1 text-slate-400">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </span>
                    </div>
                  </div>

                  {/* Assigned Participants Preview */}
                  {hasAssigned && !isExpanded && (
                    <div className="mt-3 space-y-2">
                      {names.map((personName, nIdx) => {
                        const matchedCargo = findCargoMatchByName(personName);
                        return (
                          <div
                            key={nIdx}
                            onClick={() => setExpandedCargoIdx(idx)}
                            className="bg-slate-50/90 border border-slate-200/70 rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-100/70 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-8 h-8 rounded-full bg-indigo-100/80 text-indigo-600 flex items-center justify-center shrink-0">
                                <Users className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                                  {personName}
                                </p>
                                <p className="text-[11px] font-mono text-slate-500 truncate">
                                  {matchedCargo?.creci
                                    ? `CRECI ${matchedCargo.creci}`
                                    : matchedCargo?.apelido || p.role}
                                </p>
                              </div>
                            </div>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 shrink-0">
                              {deductionVal > 0 ? `${formatPctBr(deductionVal)}% PARC.` : 'PROPORCIONAL'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!hasAssigned && !isImob && !isHidden && !isExpanded && !isReadOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedCargoIdx(idx);
                        setActivePartySearchIdx(idx);
                      }}
                      className="mt-3 w-full py-2.5 px-4 rounded-2xl bg-slate-50/90 hover:bg-indigo-50/80 border border-slate-200/80 hover:border-indigo-200 text-indigo-600 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>Adicionar Participante</span>
                    </button>
                  )}

                  {/* Inline Editor */}
                  {isExpanded && !isReadOnly && (
                    <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                            Cargo
                          </label>
                          <input
                            type="text"
                            value={p.role || ''}
                            onChange={(e) => {
                              setDraft((prev) => {
                                const next = [...prev.participantes];
                                next[idx] = { ...next[idx], role: e.target.value };
                                return { ...prev, participantes: next, isManual: false, manualWaterfall: null };
                              });
                            }}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:border-indigo-500 outline-none"
                            placeholder="Ex: Corretor"
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                              Alíquota (%)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={p.percentage ?? ''}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setDraft((prev) => {
                                  const next = [...prev.participantes];
                                  next[idx] = { ...next[idx], percentage: val };
                                  const nextSum = Number(
                                    next
                                      .reduce(
                                        (acc, cp) =>
                                          acc + (Number(cp.percentage) || 0) + (Number(cp.taxaPremio) || 0),
                                        0
                                      )
                                      .toFixed(6)
                                  );
                                  return {
                                    ...prev,
                                    participantes: next,
                                    percentualAcordo: nextSum,
                                    isManual: false,
                                    manualWaterfall: null,
                                  };
                                });
                              }}
                              className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-center text-indigo-700 focus:bg-white focus:border-indigo-500 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1">
                              Prêmio (%)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={p.taxaPremio === 0 || p.taxaPremio === undefined ? '' : p.taxaPremio}
                              placeholder="0,00"
                              onChange={(e) => {
                                const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                                setDraft((prev) => {
                                  const next = [...prev.participantes];
                                  next[idx] = { ...next[idx], taxaPremio: val };
                                  const nextSum = Number(
                                    next
                                      .reduce(
                                        (acc, cp) =>
                                          acc + (Number(cp.percentage) || 0) + (Number(cp.taxaPremio) || 0),
                                        0
                                      )
                                      .toFixed(6)
                                  );
                                  return {
                                    ...prev,
                                    participantes: next,
                                    percentualAcordo: nextSum,
                                    isManual: false,
                                    manualWaterfall: null,
                                  };
                                });
                              }}
                              className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-center text-amber-600 focus:bg-white focus:border-amber-400 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                              Parcela (%)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={p.deduction === 0 || p.deduction === undefined ? '' : p.deduction}
                              placeholder="Prop."
                              title="Deixe em branco para rateio proporcional"
                              onChange={(e) => {
                                const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                                setDraft((prev) => {
                                  const next = [...prev.participantes];
                                  next[idx] = { ...next[idx], deduction: val };
                                  return { ...prev, participantes: next, isManual: false, manualWaterfall: null };
                                });
                              }}
                              className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-center text-slate-800 focus:bg-white focus:border-indigo-500 outline-none"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="relative">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                          Participantes (separe por vírgula ou selecione da equipe)
                        </label>
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                          <input
                            type="text"
                            value={p.name || ''}
                            onFocus={() => setActivePartySearchIdx(idx)}
                            onBlur={() => setTimeout(() => setActivePartySearchIdx(null), 220)}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDraft((prev) => {
                                const next = [...prev.participantes];
                                next[idx] = { ...next[idx], name: val };
                                return { ...prev, participantes: next, isManual: false, manualWaterfall: null };
                              });
                            }}
                            className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:border-indigo-500 outline-none"
                            placeholder="Ex: Marcio Azevedo (digite @ para apelidos)"
                          />
                        </div>

                        {activePartySearchIdx === idx && (
                          <div className="absolute left-0 right-0 mt-1 max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-xl z-50 divide-y divide-slate-100">
                            {getFilteredPartySuggestions(p.name).length === 0 ? (
                              <div className="p-3 text-xs text-slate-400 text-center">
                                Nenhum participante encontrado
                              </div>
                            ) : (
                              getFilteredPartySuggestions(p.name).map((c) => (
                                <button
                                  key={c.id || c.nome}
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    selectPartyParticipant(idx, c);
                                  }}
                                  className="w-full text-left p-2.5 hover:bg-indigo-50/60 transition-colors flex items-center justify-between gap-2 cursor-pointer"
                                >
                                  <span className="font-bold text-xs text-slate-900 truncate">
                                    {c.nome} {c.apelido ? `(${c.apelido})` : ''}
                                  </span>
                                  {c.cargo && (
                                    <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-semibold shrink-0">
                                      {c.cargo}
                                    </span>
                                  )}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isHidden}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setDraft((prev) => {
                                  const next = [...prev.participantes];
                                  next[idx] = { ...next[idx], hideAndSum: checked };
                                  return { ...prev, participantes: next, isManual: false, manualWaterfall: null };
                                });
                              }}
                              className="w-3.5 h-3.5 rounded accent-indigo-600"
                            />
                            <span>Ocultar e somar na Imobiliária</span>
                          </label>

                          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isAtoFull}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setDraft((prev) => {
                                  const next = [...prev.participantes];
                                  next[idx] = {
                                    ...next[idx],
                                    priorityRule: checked ? 'ATO_FULL' : 'ORDINARIO',
                                  };
                                  return { ...prev, participantes: next, isManual: false, manualWaterfall: null };
                                });
                              }}
                              className="w-3.5 h-3.5 rounded accent-emerald-600"
                            />
                            <span>Prioridade 100% no Ato</span>
                          </label>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setDraft((prev) => ({
                                ...prev,
                                participantes: prev.participantes.filter((_, i) => i !== idx),
                                isManual: false,
                                manualWaterfall: null,
                              }));
                              setExpandedCargoIdx(null);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remover</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedCargoIdx(null)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>OK</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: RATEIO GERAL (CAPS + CHRONOLOGICAL MATRIX + CREDENTIALS) */}
      {activeTab === 'geral' && (
        <>
          {visibleParcelas.length === 0 ? (
            <div className="bg-white border border-slate-200/80 rounded-3xl p-8 text-center space-y-4">
              <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto">
                <Workflow className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  Cronograma de Rateio Aguardando Parcelas
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Preencha as parcelas na aba Parcelamento ou importe diretamente da proposta comercial para gerar o cronograma vencimento a vencimento.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('parcelas')}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                <CreditCard className="w-4 h-4" />
                <span>Configurar Parcelamento</span>
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Participantes e Tetos */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Users className="w-4 h-4" /> Distribuição por Cargo &amp; Tetos Financeiros
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {waterfall.participantes.map((p, idx) => {
                    const label = p.name ? `${p.role} - ${p.name}` : p.role;
                    const progressPercent =
                      p.cap > 0 ? Math.min(100, Math.round((p.received / p.cap) * 100)) : 0;
                    return (
                      <div
                        key={idx}
                        className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-between relative overflow-hidden group"
                      >
                        <div className="absolute top-0 right-0 w-16 h-16 bg-slate-50 rotate-45 translate-x-8 -translate-y-8 group-hover:bg-indigo-50 transition-colors" />
                        <div className="z-10">
                          <header className="flex items-center justify-between mb-3 gap-1">
                            <span
                              className="text-[10px] font-bold text-slate-500 uppercase truncate max-w-[140px]"
                              title={label}
                            >
                              {label}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[10px] font-bold text-indigo-600 font-mono bg-indigo-50 px-2 py-0.5 rounded">
                                {p.percentage.toFixed(2)}%
                              </span>
                              {p.taxaPremio !== undefined && p.taxaPremio > 0 && (
                                <span className="text-[10px] font-bold text-amber-700 font-mono bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                  +{p.taxaPremio.toFixed(2)}%
                                </span>
                              )}
                            </div>
                          </header>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-slate-500">Recebido</span>
                              <span className="text-sm font-bold text-emerald-600 font-mono">
                                {formatBRL(p.received)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-slate-500">Teto Máx.</span>
                              <span className="text-sm font-medium text-slate-400 font-mono">
                                {formatBRL(p.cap)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-4">
                          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${progressPercent}%` }}
                              className={`h-full ${p.balance <= 0.01 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                            />
                          </div>
                          <div className="flex justify-between mt-2">
                            <span className="text-[8px] font-bold text-slate-400 uppercase">
                              Progresso
                            </span>
                            <span className="text-[8px] font-bold text-slate-400 font-mono">
                              {progressPercent}%
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Tabela de Rateio Geral do Acordo */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Table className="w-4 h-4 text-indigo-600" /> Tabela de Rateio Geral do Acordo (Auditoria de Fluxo)
                </h4>
                <div className="bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm overflow-x-auto">
                  {(() => {
                    const partCount = waterfall.participantes.length;
                    const totalCols = partCount + 2;
                    const thPad =
                      totalCols > 6
                        ? 'p-2 sm:px-2.5 sm:py-2'
                        : totalCols > 4
                          ? 'p-2.5 sm:px-3 sm:py-2.5'
                          : 'p-3.5 sm:px-4 sm:py-3';
                    const thFont = totalCols > 6 ? 'text-[8.5px]' : totalCols > 4 ? 'text-[9.5px]' : 'text-[10px]';
                    const tdPad = totalCols > 6 ? 'px-2 py-2' : totalCols > 4 ? 'px-2.5 py-2.5' : 'px-3.5 py-3';
                    const tdFont = totalCols > 6 ? 'text-[10px]' : totalCols > 4 ? 'text-[11px]' : 'text-xs';
                    const inputWidth = totalCols > 6 ? 'w-20 text-[10px]' : totalCols > 4 ? 'w-22 text-[10.5px]' : 'w-24 text-xs';

                    return (
                      <table className="w-full text-left border-collapse table-print font-sans">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100">
                            <th
                              className={`${thPad} ${thFont} font-bold text-slate-400 uppercase text-left align-top whitespace-nowrap min-w-[85px]`}
                            >
                              Vencimento
                            </th>
                            <th
                              className={`${thPad} ${thFont} font-bold text-indigo-600 uppercase text-right align-top whitespace-nowrap min-w-[100px]`}
                            >
                              Parcela Acordo
                            </th>
                            {waterfall.participantes.map((p, pIdx) => {
                              const label = p.name ? `${p.role} - ${p.name}` : p.role;
                              const apelido = getParticipantApelido(p.name);
                              return (
                                <th
                                  key={pIdx}
                                  className={`${thPad} ${thFont} font-bold text-slate-400 uppercase text-right align-top min-w-[85px]`}
                                >
                                  <div className="leading-tight text-right ml-auto" title={label}>
                                    <div className="font-bold text-slate-700 uppercase">{p.role}</div>
                                    {apelido && (
                                      <div className="font-medium text-slate-500 normal-case mt-0.5">
                                        {apelido}
                                      </div>
                                    )}
                                  </div>
                                  {isEditingTable && (
                                    <div className="mt-1.5 pt-1.5 border-t border-slate-200 text-[8.5px] font-mono normal-case text-right font-normal space-y-0.5">
                                      <div className="text-slate-500 whitespace-nowrap">
                                        Teto: <span className="font-bold text-slate-700">{formatBRL(p.cap)}</span>
                                      </div>
                                      <div className="text-emerald-600 whitespace-nowrap">
                                        Soma: <span className="font-bold">{formatBRL(p.received)}</span>
                                      </div>
                                      <div
                                        className={`whitespace-nowrap ${
                                          Math.abs(p.balance) < 0.01
                                            ? 'text-slate-400'
                                            : p.balance > 0
                                              ? 'text-amber-600 font-bold'
                                              : 'text-rose-600 font-bold'
                                        }`}
                                      >
                                        Dif: <span>{formatBRL(p.balance)}</span>
                                      </div>
                                    </div>
                                  )}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {visibleParcelas.map((det, idx) => {
                            const rowDistributedTotal = Object.values(det.distribuicao || {}).reduce(
                              (sum: number, v: any) => sum + (Number(v) || 0),
                              0
                            );
                            const isBalanced = Math.abs(rowDistributedTotal - det.valorAcordoToShow) < 0.01;

                            return (
                              <tr key={idx} className="hover:bg-indigo-50/10 transition-colors">
                                <td className={`${tdPad} ${tdFont} font-medium text-slate-700 whitespace-nowrap font-mono`}>
                                  {isEditingTable ? (
                                    <input
                                      type="text"
                                      value={det.vencimentoToShow || ''}
                                      onChange={(e) => handleVencimentoEdit(det.originalIndex, e.target.value)}
                                      className={`${inputWidth} px-1.5 py-0.5 font-mono border border-slate-200 rounded focus:border-indigo-500 outline-none bg-white text-slate-900`}
                                      placeholder="DD/MM/AAAA"
                                    />
                                  ) : (
                                    det.vencimentoToShow
                                  )}
                                </td>
                                <td className={`${tdPad} ${tdFont} font-bold font-mono text-right text-indigo-600 whitespace-nowrap`}>
                                  <div>{formatBRL(det.valorAcordoToShow)}</div>
                                  {isEditingTable && (
                                    <div
                                      className={`text-[8.5px] font-medium mt-0.5 whitespace-nowrap ${
                                        isBalanced
                                          ? 'text-emerald-600'
                                          : rowDistributedTotal > det.valorAcordoToShow
                                            ? 'text-rose-600'
                                            : 'text-slate-400'
                                      }`}
                                    >
                                      Dist: {formatBRL(rowDistributedTotal)}
                                    </div>
                                  )}
                                </td>
                                {waterfall.participantes.map((p, pIdx) => {
                                  const label = p.name ? `${p.role} - ${p.name}` : p.role;
                                  const val = det.distribuicao[label] || 0;
                                  return (
                                    <td
                                      key={pIdx}
                                      className={`${tdPad} ${tdFont} font-mono text-right text-slate-800 whitespace-nowrap`}
                                    >
                                      {isEditingTable ? (
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          value={val === 0 ? '' : val}
                                          onChange={(e) =>
                                            handleCellEdit(det.originalIndex, label, e.target.value)
                                          }
                                          className={`${inputWidth} px-1.5 py-0.5 text-right font-mono border border-slate-200 rounded focus:border-indigo-500 outline-none bg-slate-50/50`}
                                          placeholder="0,00"
                                        />
                                      ) : val > 0 ? (
                                        <span className="tabular-nums tracking-tight font-medium">
                                          {formatBRL(val)}
                                        </span>
                                      ) : (
                                        <span className="text-slate-300">-</span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold">
                            <td className={`${tdPad} ${tdFont} text-slate-900 uppercase`}>
                              Total ({isLiquidada ? '100% Liquidado' : 'Parcial'})
                            </td>
                            <td className={`${tdPad} ${tdFont} font-mono text-right text-indigo-700`}>
                              {formatBRL(
                                visibleParcelas.reduce((acc, d) => acc + d.valorAcordoToShow, 0)
                              )}
                            </td>
                            {waterfall.participantes.map((p, pIdx) => (
                              <td
                                key={pIdx}
                                className={`${tdPad} ${tdFont} font-mono text-right text-emerald-700`}
                              >
                                {formatBRL(p.received)}
                              </td>
                            ))}
                          </tr>
                        </tfoot>
                      </table>
                    );
                  })()}
                </div>
              </div>

              {/* Credenciais dos Participantes */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Users className="w-4 h-4" /> Credenciais dos Participantes no Acordo
                </h4>
                <div className="bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm overflow-x-auto">
                  <table className="w-full text-left border-collapse font-sans">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="p-3.5 text-[10px] font-bold text-slate-400 uppercase">Nome</th>
                        <th className="p-3.5 text-[10px] font-bold text-slate-400 uppercase">Apelido</th>
                        <th className="p-3.5 text-[10px] font-bold text-slate-400 uppercase">CPF / CNPJ</th>
                        <th className="p-3.5 text-[10px] font-bold text-slate-400 uppercase">CRECI</th>
                        <th className="p-3.5 text-[10px] font-bold text-slate-400 uppercase">Cargo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeCredentialsList.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-xs text-slate-400 italic">
                            Nenhum participante nomeado vinculado a este acordo ainda. Selecione colaboradores na aba Lista de Cargos.
                          </td>
                        </tr>
                      ) : (
                        activeCredentialsList.map((part, pIdx) => (
                          <tr key={pIdx} className="hover:bg-slate-50 transition-colors">
                            <td className="p-3.5 text-xs font-bold text-slate-800">{part.nome}</td>
                            <td className="p-3.5 text-xs text-slate-600">{part.apelido}</td>
                            <td className="p-3.5 text-xs font-mono text-slate-600">{part.cpf}</td>
                            <td className="p-3.5 text-xs font-mono text-slate-600">{part.creci}</td>
                            <td className="p-3.5 text-xs">
                              <div className="flex flex-wrap gap-1">
                                {part.cargo.split(',').map((c, cIdx) => (
                                  <span
                                    key={cIdx}
                                    className="bg-indigo-50 text-indigo-600 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                                  >
                                    {c.trim()}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* TAB 4: LAUDO TÉCNICO (4 SECTIONS PER AGENTS.MD) */}
      {activeTab === 'especialista' && (
        <div className="space-y-5">
          {!diagnostico ? (
            <div className="bg-white border border-slate-200/80 rounded-3xl p-8 text-center space-y-3">
              <FileText className="w-8 h-8 text-slate-300 mx-auto" />
              <h3 className="text-base font-bold text-slate-900">
                Laudo Técnico Aguardando Fluxo do Acordo
              </h3>
              <p className="text-xs text-slate-500">
                Cadastre as parcelas do acordo para gerar a auditoria técnica completa em 4 seções.
              </p>
            </div>
          ) : (
            <>
              {/* Seção I */}
              <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs">
                <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider">
                    Seção I — Memória de Cálculo e Parâmetros de Entrada
                  </h4>
                  <span className="text-[11px] font-mono text-emerald-300 font-bold">
                    {diagnostico.secaoI.consistenciaAliquotas ? 'CONCILIADO' : 'REVISAR ALÍQUOTAS'}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-bold uppercase text-slate-500">
                        <th className="p-3">Participante</th>
                        <th className="p-3 text-right">Alíquota</th>
                        <th className="p-3 text-right">Teto Nominal</th>
                        <th className="p-3">Regra / Exceção</th>
                        <th className="p-3">Hierarquia</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {diagnostico.secaoI.participantes.map((p, i) => (
                        <tr key={i}>
                          <td className="p-3 font-bold text-slate-900">{p.label}</td>
                          <td className="p-3 text-right font-mono text-indigo-700 font-bold">
                            {formatPctBr(p.aliquotaVGV + (p.taxaPremio || 0))}%
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-slate-900">
                            {formatBRL(p.tetoNominal)}
                          </td>
                          <td className="p-3 text-slate-600">{p.excecao}</td>
                          <td className="p-3 text-slate-500">{p.tierLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Seção II */}
              <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Seção II — Amortização do Fluxo de Parcelas do Acordo
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/70 border-b border-slate-100 text-[10px] font-bold uppercase text-slate-500">
                        <th className="p-3">#</th>
                        <th className="p-3">Vencimento</th>
                        <th className="p-3">Tipo</th>
                        <th className="p-3 text-right">Parcela Bruta</th>
                        <th className="p-3 text-right">Dedução Aplicada</th>
                        <th className="p-3 text-right">Saldo Residual Acordo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {diagnostico.secaoII.map((row) => (
                        <tr key={row.linha}>
                          <td className="p-3 text-slate-400">{row.linha}</td>
                          <td className="p-3 text-slate-700">{row.vencimento}</td>
                          <td className="p-3 font-sans text-slate-700">{row.tipo}</td>
                          <td className="p-3 text-right text-slate-800">{formatBRL(row.parcelaBruta)}</td>
                          <td className="p-3 text-right font-bold text-indigo-700">
                            {formatBRL(row.deducaoAplicada)}
                          </td>
                          <td className="p-3 text-right font-bold text-emerald-700">
                            {formatBRL(row.saldoDevedorComissao)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Seção IV: Inflexões e Quitação */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Seção IV — Diagnóstico de Eventos Críticos (Inflexões &amp; Cascata)
                </h4>
                {diagnostico.secaoIV.inflexoes.length === 0 ? (
                  <p className="text-xs text-slate-500">Nenhuma inflexão de quitação registrada.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {diagnostico.secaoIV.inflexoes.map((inf, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 truncate">{inf.participante}</p>
                          <p className="text-[11px] text-slate-500">
                            Quitado em {inf.parcelaQuitacao} · {inf.vencimento}
                          </p>
                        </div>
                        <span className="font-mono font-bold text-emerald-700 shrink-0">
                          {formatBRL(inf.tetoAtingido)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {diagnostico.secaoIV.liberacaoFluxoIntegral && (
                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                    <strong>Quitação Integral:</strong>{' '}
                    {diagnostico.secaoIV.liberacaoFluxoIntegral.parcela} em{' '}
                    <strong>{diagnostico.secaoIV.liberacaoFluxoIntegral.vencimento}</strong>. Passivo
                    100% liquidado com saldo residual zero.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {/* Print Preview & Print Execution Modal (A4 Landscape) */}
      {printPreviewMode && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-[95vw] xl:max-w-[92vw] max-h-[92vh] border border-slate-200 flex flex-col overflow-hidden">
            <div className="px-4 sm:px-6 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <Printer className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-900 truncate">
                    Impressão — Rateio de Acordo
                  </h3>
                  <p className="text-[11px] text-slate-500 truncate">
                    {draft.titulo} {draft.referencia ? `• ${draft.referencia}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPrintPreviewMode(null)}
                aria-label="Fechar prévia de impressão"
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 sm:px-6 py-2.5 bg-slate-50 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="inline-flex flex-wrap items-center bg-white border border-slate-200 rounded-xl p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setPrintPreviewMode('rateio')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    printPreviewMode === 'rateio'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Tabela de Rateio Geral
                </button>
                <button
                  type="button"
                  disabled={!diagnostico}
                  onClick={() => setPrintPreviewMode('laudo')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 ${
                    printPreviewMode === 'laudo'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Laudo Técnico (4 Seções)
                </button>
                <button
                  type="button"
                  onClick={() => setPrintPreviewMode('webropay')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    printPreviewMode === 'webropay'
                      ? 'bg-emerald-600 text-white'
                      : 'text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Planilha WebroPay</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {printPreviewMode === 'webropay' && (
                  <button
                    type="button"
                    onClick={handleDownloadWebropayExcel}
                    disabled={isExportingWebropay}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-60"
                    title="Baixar arquivo Excel (.xlsx) no modelo oficial para importação no WebroPay"
                  >
                    {isExportingWebropay ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                    )}
                    <span>Excel (.xlsx)</span>
                  </button>
                )}
                {onOpenNovacaoPrint && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setPrintPreviewMode(null);
                        onOpenNovacaoPrint(draft, 'novacao');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#eef0ff] hover:bg-[#e3e6ff] border border-[#c7c2ff] text-xs font-bold text-[#4338ca] transition-colors cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Minuta Novação</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPrintPreviewMode(null);
                        onOpenNovacaoPrint(draft, 'confissao');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs font-bold text-slate-800 transition-colors cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Confissão de Dívida</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleDownloadPrintPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPrintHtml}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">HTML</span>
                </button>
                <button
                  type="button"
                  onClick={executePrintFromPreview}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Imprimir Agora</span>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden bg-slate-200/75 p-3 sm:p-5 flex justify-center">
              <div className="w-full h-full bg-white rounded-xl shadow-lg border border-slate-300 overflow-hidden">
                <iframe
                  ref={printPreviewIframeRef}
                  title="Prévia de Impressão — Rateio de Acordo"
                  srcDoc={printDocumentHtml}
                  sandbox=""
                  className="w-full h-full min-h-[62vh] border-0 bg-white"
                />
              </div>
            </div>

            <div className="px-4 sm:px-6 py-3 bg-white border-t border-slate-100 flex items-center justify-between gap-3 shrink-0">
              <p className="text-[11px] text-slate-500">
                Layout formatado para folha A4 Paisagem com bordas completas e valores tabulares.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPrintPreviewMode(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Fechar
                </button>
                {printPreviewMode === 'webropay' && (
                  <button
                    type="button"
                    onClick={handleDownloadWebropayExcel}
                    disabled={isExportingWebropay}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-60"
                  >
                    {isExportingWebropay ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                    )}
                    <span>Baixar Planilha (.xlsx)</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDownloadPrintPdf}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar PDF (A4)</span>
                </button>
                <button
                  type="button"
                  onClick={executePrintFromPreview}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Imprimir Agora</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};
