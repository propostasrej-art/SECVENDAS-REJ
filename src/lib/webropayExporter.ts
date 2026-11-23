import ExcelJS from 'exceljs';
import { ExtractionResult, CargoCadastro, AddressData } from '../types';
import { WaterfallResult } from './waterfallCalculator';

export const WEBROPAY_TIPOS_OPERACAO = [
  'Acordo',
  'Renegociação',
  'Apartamento',
  'Casa',
  'Lote',
  'Prêmio',
  'Sorteio',
  'Migração',
  'Personalização',
  'Vaga de Carro',
  'Vaga Box',
  'Sala Comercial',
  'Vaga de moto',
  'Secundário',
] as const;

export interface WebropayPagadorOverride {
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

export interface WebropayExportOptions {
  proposal: ExtractionResult;
  waterfall: WaterfallResult;
  cargos?: CargoCadastro[];
  simulacaoFluxo?: any[];
  tipoOperacao?: string;
  customFileName?: string;
  pagadorOverrides?: WebropayPagadorOverride;
  visibleParcelasOverride?: Array<{
    vencimentoToShow: string;
    valorComissaoToShow: number;
    distribuicao: Record<string, number>;
  }>;
}

export interface WebropayBeneficiarioRow {
  nomeComissionado: string;
  cpfCnpj: string;
  parcelas: number[];
  total: number;
}

export interface WebropayPagadorField {
  label: string;
  value: string | number;
  displayValue: string;
  format?: string;
  isNumeric?: boolean;
  dataValidation?: ExcelJS.DataValidation;
}

export interface WebropaySheetData {
  parcelas: Array<{
    numero: number;
    vencimento: string;
    valorTotalParcela: number;
  }>;
  beneficiarios: WebropayBeneficiarioRow[];
  totaisPorParcela: number[];
  totalGeralDistribuido: number;
  pagadorFields: WebropayPagadorField[];
  defaultFileName: string;
}

function formatAddress(addr?: AddressData): string {
  if (!addr) return '';
  const parts: string[] = [];
  if (addr.logradouro) {
    let str = addr.logradouro;
    if (addr.numero) str += `, ${addr.numero}`;
    if (addr.complemento) str += ` (${addr.complemento})`;
    parts.push(str);
  }
  if (addr.bairro) parts.push(addr.bairro);
  if (addr.cidade) {
    parts.push(addr.estado ? `${addr.cidade}/${addr.estado}` : addr.cidade);
  }
  return parts.join(' - ');
}

function normalizeDateBR(raw?: string): string {
  if (!raw || !raw.trim()) return '';
  const clean = raw.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) return clean;
  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  const parsed = new Date(clean);
  if (!isNaN(parsed.getTime())) {
    const dd = String(parsed.getDate()).padStart(2, '0');
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const yyyy = parsed.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return clean;
}

function getColumnLetter(colNumber: number): string {
  let temp = colNumber;
  let letter = '';
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

export function buildWebropaySheetData({
  proposal,
  waterfall,
  cargos = [],
  simulacaoFluxo,
  tipoOperacao = 'Apartamento',
  customFileName,
  pagadorOverrides,
  visibleParcelasOverride,
}: WebropayExportOptions): WebropaySheetData {
  const customer =
    (proposal.customers && proposal.customers.length > 0 ? proposal.customers[0] : null) ||
    (proposal as any).customer ||
    null;
  const address = proposal.address || customer?.address;
  const property = proposal.property;

  let visibleParcelas: Array<{
    vencimentoToShow: string;
    valorComissaoToShow: number;
    distribuicao: Record<string, number>;
  }> = [];

  if (visibleParcelasOverride && visibleParcelasOverride.length > 0) {
    visibleParcelas = visibleParcelasOverride.map((p) => ({
      vencimentoToShow: p.vencimentoToShow,
      valorComissaoToShow: Number((p.valorComissaoToShow || 0).toFixed(2)),
      distribuicao: p.distribuicao || {},
    }));
  } else {
    let runningSum = 0;
    for (let idx = 0; idx < waterfall.detalhesParcelas.length; idx++) {
      const det = waterfall.detalhesParcelas[idx];
      const correspondingSimFluxo =
        simulacaoFluxo && idx < simulacaoFluxo.length && waterfall.detalhesParcelas.length > 1
          ? simulacaoFluxo[idx]
          : null;

      const vencimentoToShow = correspondingSimFluxo ? correspondingSimFluxo.vencimento : det.vencimento;
      const valorComissaoToShow = correspondingSimFluxo
        ? Number((correspondingSimFluxo.valorTotal - correspondingSimFluxo.valorLiquido).toFixed(2))
        : det.valorRetido;

      if (valorComissaoToShow > 0) {
        visibleParcelas.push({
          vencimentoToShow,
          valorComissaoToShow,
          distribuicao: det.distribuicao || {},
        });
      }
      runningSum = Number((runningSum + valorComissaoToShow).toFixed(2));
      if (runningSum >= waterfall.comissaoTotal - 0.01 && waterfall.comissaoTotal > 0) {
        break;
      }
    }
  }

  const numParcelaCols = Math.max(1, visibleParcelas.length);
  const parcelas = Array.from({ length: numParcelaCols }, (_, idx) => {
    const p = visibleParcelas[idx];
    return {
      numero: idx + 1,
      vencimento: p ? p.vencimentoToShow || 'dd/mm/aaaa' : 'dd/mm/aaaa',
      valorTotalParcela: p ? Number((p.valorComissaoToShow || 0).toFixed(2)) : 0,
    };
  });

  const totaisPorParcela = Array.from({ length: numParcelaCols }, () => 0);

  const beneficiarios: WebropayBeneficiarioRow[] = waterfall.participantes.map((p) => {
    const matchedCargo = cargos.find((c) => {
      const matchName = p.name && c.nome && c.nome.trim().toLowerCase() === p.name.trim().toLowerCase();
      const matchRole = c.cargo && c.cargo.trim().toLowerCase() === p.role.trim().toLowerCase();
      const matchNick = p.name && c.apelido && c.apelido.trim().toLowerCase() === p.name.trim().toLowerCase();
      return matchName || matchNick || (matchRole && !p.name);
    });

    const participantLabel = p.name ? `${p.role} - ${p.name}` : p.role;
    const cpfCnpj = matchedCargo?.cpf_cnpj || '';

    const values = Array.from({ length: numParcelaCols }, (_, cIdx) => {
      const parcela = visibleParcelas[cIdx];
      const val = parcela
        ? Number((parcela.distribuicao[participantLabel] ?? parcela.distribuicao[p.role] ?? 0).toFixed(2))
        : 0;
      totaisPorParcela[cIdx] = Number((totaisPorParcela[cIdx] + val).toFixed(2));
      return val;
    });

    const total = Number(values.reduce((acc, v) => acc + v, 0).toFixed(2));

    return {
      nomeComissionado: p.name ? `${p.name} (${p.role})` : p.role,
      cpfCnpj,
      parcelas: values,
      total,
    };
  });

  const totalGeralDistribuido = Number(beneficiarios.reduce((acc, b) => acc + b.total, 0).toFixed(2));

  const fallbackDataVenda =
    normalizeDateBR((proposal as any).data_venda) ||
    normalizeDateBR((proposal as any).dataVenda) ||
    normalizeDateBR(proposal.payments?.[0]?.vencimento) ||
    normalizeDateBR(visibleParcelas[0]?.vencimentoToShow) ||
    normalizeDateBR((proposal as any).created_at) ||
    new Date().toLocaleDateString('pt-BR');

  const fallbackTorreUnidade =
    [
      property?.torre ? `Torre ${property.torre}` : '',
      property?.unidade ? `Unidade ${property.unidade}` : '',
    ]
      .filter(Boolean)
      .join(' / ') ||
    property?.unidade ||
    '';

  const fallbackEndereco =
    formatAddress(address || customer?.address) ||
    property?.endereco ||
    property?.localizacao ||
    [property?.cidade, property?.estado].filter(Boolean).join('/') ||
    '';

  const nomeRazao = (pagadorOverrides?.nomeRazaoSocial ?? customer?.nome ?? '').trim();
  const emailVal = (pagadorOverrides?.email ?? customer?.email ?? '').trim();
  const cpfCnpjVal = (pagadorOverrides?.cpfCnpj ?? customer?.cpf ?? '').trim();
  const telefoneVal = (pagadorOverrides?.telefone ?? customer?.telefone ?? '').trim();
  const cepVal = (pagadorOverrides?.cep ?? address?.cep ?? customer?.address?.cep ?? '').trim();
  const enderecoVal = (pagadorOverrides?.endereco ?? fallbackEndereco).trim();
  const empreendimentoVal = (
    pagadorOverrides?.nomeEmpreendimento ?? property?.empreendimento ?? ''
  ).trim();
  const torreUnidadeVal = (pagadorOverrides?.torreUnidade ?? fallbackTorreUnidade).trim();
  const tipoVal = (pagadorOverrides?.tipo ?? tipoOperacao).trim() || tipoOperacao;
  const dataVendaVal =
    normalizeDateBR(pagadorOverrides?.dataVenda) || fallbackDataVenda;
  const vendaNumeric = Number(
    (
      (typeof pagadorOverrides?.valorVenda === 'number' && !isNaN(pagadorOverrides.valorVenda)
        ? pagadorOverrides.valorVenda
        : waterfall.vendaTotal || proposal.valorTotalProposta || 0)
    ).toFixed(2)
  );
  const comissaoNumeric = Number(
    (
      (typeof pagadorOverrides?.valorComissao === 'number' && !isNaN(pagadorOverrides.valorComissao)
        ? pagadorOverrides.valorComissao
        : waterfall.comissaoTotal || 0)
    ).toFixed(2)
  );
  const idExternoVal = (pagadorOverrides?.idExterno ?? proposal.id ?? '').trim();

  const numberDecFmt = '#,##0.00';
  const fmtBrlVal = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const pagadorFields: WebropayPagadorField[] = [
    { label: 'Nome/razão social:', value: nomeRazao, displayValue: nomeRazao || '-' },
    { label: 'Email:', value: emailVal, displayValue: emailVal || '-' },
    { label: 'CPF/CNPJ:', value: cpfCnpjVal, displayValue: cpfCnpjVal || '-' },
    { label: 'Telefone:', value: telefoneVal, displayValue: telefoneVal || '-' },
    { label: 'CEP:', value: cepVal, displayValue: cepVal || '-' },
    { label: 'Endereço:', value: enderecoVal, displayValue: enderecoVal || '-' },
    {
      label: 'Nome do Empreendimento:',
      value: empreendimentoVal,
      displayValue: empreendimentoVal || '-',
    },
    { label: 'Torre/Unidade:', value: torreUnidadeVal, displayValue: torreUnidadeVal || '-' },
    {
      label: 'Tipo:',
      value: tipoVal,
      displayValue: tipoVal,
      dataValidation: {
        type: 'list',
        allowBlank: true,
        formulae: [
          '"Prêmio,Sorteio,Apartamento,Lote,Renegociação,Acordo,Migração,Casa,Personalização,Vaga de Carro,Vaga Box,Sala Comercial,Vaga de moto,Secundário"',
        ],
      },
    },
    { label: 'Data da Venda:', value: dataVendaVal, displayValue: dataVendaVal || '-', format: 'd/m/yyyy' },
    {
      label: 'Valor da Venda:',
      value: vendaNumeric,
      displayValue: fmtBrlVal(vendaNumeric),
      format: numberDecFmt,
      isNumeric: true,
    },
    {
      label: 'Valor da Comissão:',
      value: comissaoNumeric,
      displayValue: fmtBrlVal(comissaoNumeric),
      format: numberDecFmt,
      isNumeric: true,
    },
    { label: 'Id externo:', value: idExternoVal, displayValue: idExternoVal || '-' },
  ];

  const unidadeSanitizada = (property?.unidade || torreUnidadeVal || 'unidade').replace(/[^a-zA-Z0-9_-]/g, '_');
  const defaultFileName = customFileName || `webropay_contrato_${unidadeSanitizada}.xlsx`;

  return {
    parcelas,
    beneficiarios,
    totaisPorParcela,
    totalGeralDistribuido,
    pagadorFields,
    defaultFileName,
  };
}

export async function generateWebropayExcel(options: WebropayExportOptions): Promise<void> {
  const sheetData = buildWebropaySheetData(options);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sistema de Propostas e Rateio Imobiliário';
  workbook.lastModifiedBy = 'Webropay Exporter';
  workbook.created = new Date();
  workbook.modified = new Date();

  const numParcelaCols = Math.max(1, sheetData.parcelas.length);
  const currencyNumFmt = '_-"R$ "* #,##0.00_-;"-R$ "* #,##0.00_-;_-"R$ "* \\-??_-;_-@_-';

  // -------------------------------------------------------------
  // ABA 1: BENEFICIÁRIOS (Sem totais, sem colunas fantasmas)
  // -------------------------------------------------------------
  const wsBeneficiarios = workbook.addWorksheet('Beneficiários', {
    views: [{ showGridLines: true }],
  });

  const lastInstallmentColLetter = getColumnLetter(2 + numParcelaCols);

  wsBeneficiarios.mergeCells(`A1:${lastInstallmentColLetter}1`);
  const cellA1 = wsBeneficiarios.getCell('A1');
  cellA1.value = 'Rateio das comissões';
  cellA1.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  cellA1.alignment = { horizontal: 'center', vertical: 'middle' };
  cellA1.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };
  wsBeneficiarios.getRow(1).height = 28;

  const row2 = wsBeneficiarios.getRow(2);
  row2.height = 20;
  for (let c = 1; c <= numParcelaCols; c++) {
    const colIndex = 2 + c;
    const cell = row2.getCell(colIndex);
    cell.value = `Parcela ${c}`;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF334155' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF1F5F9' },
    };
  }

  const row3 = wsBeneficiarios.getRow(3);
  row3.height = 22;

  const cellA3 = row3.getCell(1);
  cellA3.value = 'Nome do Comissionado';
  cellA3.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E293B' } };
  cellA3.alignment = { horizontal: 'left', vertical: 'middle' };
  cellA3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

  const cellB3 = row3.getCell(2);
  cellB3.value = 'CPF/CNPJ';
  cellB3.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E293B' } };
  cellB3.alignment = { horizontal: 'center', vertical: 'middle' };
  cellB3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

  for (let c = 1; c <= numParcelaCols; c++) {
    const colIndex = 2 + c;
    const cell = row3.getCell(colIndex);
    const parcela = sheetData.parcelas[c - 1];
    cell.value = parcela ? parcela.vencimento : 'dd/mm/aaaa';
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF475569' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  }

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  };

  for (let c = 1; c <= 2 + numParcelaCols; c++) {
    row2.getCell(c).border = thinBorder;
    row3.getCell(c).border = thinBorder;
  }

  let currentRowIdx = 4;
  sheetData.beneficiarios.forEach((b) => {
    const row = wsBeneficiarios.getRow(currentRowIdx);
    row.height = 20;

    const cellA = row.getCell(1);
    cellA.value = b.nomeComissionado;
    cellA.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
    cellA.alignment = { horizontal: 'left', vertical: 'middle' };
    cellA.border = thinBorder;

    const cellB = row.getCell(2);
    cellB.value = b.cpfCnpj;
    cellB.font = { name: 'Calibri', size: 10, color: { argb: 'FF334155' } };
    cellB.alignment = { horizontal: 'center', vertical: 'middle' };
    cellB.border = thinBorder;

    for (let c = 1; c <= numParcelaCols; c++) {
      const colIndex = 2 + c;
      const cell = row.getCell(colIndex);
      cell.value = Number((b.parcelas[c - 1] || 0).toFixed(2));
      cell.numFmt = currencyNumFmt;
      cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      cell.border = thinBorder;
    }

    currentRowIdx++;
  });

  wsBeneficiarios.getColumn(1).width = 32;
  wsBeneficiarios.getColumn(2).width = 20;
  for (let c = 1; c <= numParcelaCols; c++) {
    wsBeneficiarios.getColumn(2 + c).width = 18;
  }

  // -------------------------------------------------------------
  // ABA 2: PAGADOR
  // -------------------------------------------------------------
  const wsPagador = workbook.addWorksheet('Pagador', {
    views: [{ showGridLines: true }],
  });

  wsPagador.mergeCells('A1:B1');
  const cellPagA1 = wsPagador.getCell('A1');
  cellPagA1.value = 'DADOS DO PAGADOR';
  cellPagA1.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  cellPagA1.alignment = { horizontal: 'center', vertical: 'middle' };
  cellPagA1.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };
  wsPagador.getRow(1).height = 26;

  sheetData.pagadorFields.forEach((f, idx) => {
    const rowNum = idx + 2;
    const row = wsPagador.getRow(rowNum);
    row.height = 21;

    const cellA = row.getCell(1);
    cellA.value = f.label;
    cellA.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF334155' } };
    cellA.alignment = { horizontal: 'left', vertical: 'middle' };
    cellA.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF8FAFC' },
    };
    cellA.border = thinBorder;

    const cellB = row.getCell(2);
    cellB.value = f.value;
    cellB.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
    cellB.alignment = {
      horizontal: f.isNumeric ? 'right' : 'left',
      vertical: 'middle',
    };
    cellB.border = thinBorder;

    if (f.format) {
      cellB.numFmt = f.format;
    }

    if (f.dataValidation) {
      cellB.dataValidation = f.dataValidation;
    }
  });

  wsPagador.getColumn(1).width = 28;
  wsPagador.getColumn(2).width = 46;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = sheetData.defaultFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
}
