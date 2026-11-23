import React, { useEffect, useMemo, useState } from 'react';
import {
  FileText,
  Printer,
  RotateCcw,
  X,
  Users,
  User,
  Building2,
  Calculator,
  Eye,
  Edit3,
  Download,
} from 'lucide-react';
import { Empreendimento, SavedExtraction } from '../types';
import { AcordoRateioRecord } from './RateioAcordoModule';
import {
  LegalDocumentType,
  NovacaoFinAcordoInput,
  NovacaoFormData,
  applyAcordoAndRateioToNovacao,
  applyExtractionToNovacao,
  buildConfissaoDividaPrintHtml,
  buildInitialNovacaoData,
  buildNovacaoPrintHtml,
  createEmptyNovacaoData,
  formatCurrencyNumberBR,
  numeroPorExtensoPtBr,
  parseCurrencyString,
  valorPorExtensoBRL,
} from '../utils/novacaoTemplate';
import {
  downloadHtmlFile,
  generateConfissaoDividaPdf,
  generateNovacaoPdf,
  printHtmlDirect,
} from '../utils/printEngine';

interface NovacaoPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDocType?: LegalDocumentType;
  initialAcordo?: NovacaoFinAcordoInput | null;
  initialRateio?: AcordoRateioRecord | null;
  finAcordos: NovacaoFinAcordoInput[];
  acordoRateios: AcordoRateioRecord[];
  savedExtractions: SavedExtraction[];
  empreendimentos: Empreendimento[];
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const NovacaoPrintModal: React.FC<NovacaoPrintModalProps> = ({
  isOpen,
  onClose,
  initialDocType = 'novacao',
  initialAcordo,
  initialRateio,
  finAcordos,
  acordoRateios,
  savedExtractions,
  empreendimentos,
  onNotify,
}) => {
  const [docType, setDocType] = useState<LegalDocumentType>(initialDocType);
  const [activeTab, setActiveTab] = useState<'form' | 'preview'>('form');
  const [selectedExtractionId, setSelectedExtractionId] = useState<string>('');
  const [selectedAcordoKey, setSelectedAcordoKey] = useState<string>('');
  const [form, setForm] = useState<NovacaoFormData>(() => createEmptyNovacaoData());

  useEffect(() => {
    if (!isOpen) return;
    setDocType(initialDocType);
    setActiveTab('form');
    setSelectedExtractionId('');
    setSelectedAcordoKey(
      initialRateio
        ? `rat:${initialRateio.id}`
        : initialAcordo
          ? `fin:${initialAcordo.id}`
          : ''
    );
    setForm(
      buildInitialNovacaoData({
        acordo: initialAcordo || null,
        rateio: initialRateio || null,
        acordoRateios,
        savedExtractions,
        empreendimentos,
      })
    );
  }, [isOpen, initialDocType, initialAcordo, initialRateio, acordoRateios, savedExtractions, empreendimentos]);

  const isConfissao = docType === 'confissao';

  const previewHtml = useMemo(
    () => (isConfissao ? buildConfissaoDividaPrintHtml(form) : buildNovacaoPrintHtml(form)),
    [form, isConfissao]
  );

  const valOriginalNum = parseCurrencyString(form.valorDividaOriginal);
  const novoValorNum = parseCurrencyString(form.novoValor);
  const qtdParcelasNum = Math.floor(parseCurrencyString(form.quantidadeParcelas));
  const valorParcelaNum = parseCurrencyString(form.valorParcela);

  const valorEntradaNum = parseCurrencyString(form.valorEntrada);
  const qtdRestantesNum = Math.floor(parseCurrencyString(form.qtdParcelasRestantes));
  const valorParcelaRestanteNum = parseCurrencyString(form.valorParcelaRestante);

  if (!isOpen) return null;

  const updateField = <K extends keyof NovacaoFormData>(key: K, value: NovacaoFormData[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'novoValor' || key === 'quantidadeParcelas') {
        const nv = parseCurrencyString(key === 'novoValor' ? String(value) : next.novoValor);
        const qp = Math.floor(
          parseCurrencyString(key === 'quantidadeParcelas' ? String(value) : next.quantidadeParcelas)
        );
        if (nv > 0 && qp > 0) {
          next.valorParcela = formatCurrencyNumberBR(nv / qp);
        }
      }
      if (key === 'valorDividaOriginal' || key === 'valorEntrada' || key === 'qtdParcelasRestantes') {
        const vt = parseCurrencyString(
          key === 'valorDividaOriginal' ? String(value) : next.valorDividaOriginal || next.novoValor
        );
        const ve = parseCurrencyString(key === 'valorEntrada' ? String(value) : next.valorEntrada);
        const qr = Math.floor(
          parseCurrencyString(key === 'qtdParcelasRestantes' ? String(value) : next.qtdParcelasRestantes)
        );
        const saldo = vt - ve;
        if (saldo > 0 && qr > 0) {
          next.valorParcelaRestante = formatCurrencyNumberBR(saldo / qr);
        }
      }
      return next;
    });
  };

  const handleSelectExtraction = (extId: string) => {
    setSelectedExtractionId(extId);
    const ext = savedExtractions.find((e) => e.id === extId);
    if (!ext) return;
    setForm((prev) => applyExtractionToNovacao(prev, ext, empreendimentos));
    onNotify?.('Dados da proposta importados para a minuta.', 'success');
  };

  const handleSelectAcordoOrRateio = (key: string) => {
    setSelectedAcordoKey(key);
    if (!key) return;
    if (key.startsWith('fin:')) {
      const id = key.slice(4);
      const ac = finAcordos.find((a) => a.id === id) || null;
      const rat = ac
        ? acordoRateios.find(
            (r) =>
              r.linkedFinAcordoId === ac.id ||
              r.titulo.trim().toLowerCase() === ac.beneficiario.trim().toLowerCase()
          ) || null
        : null;
      setForm((prev) => applyAcordoAndRateioToNovacao(prev, ac, rat));
      onNotify?.('Condições do acordo aplicadas à minuta.', 'success');
    } else if (key.startsWith('rat:')) {
      const id = key.slice(4);
      const rat = acordoRateios.find((r) => r.id === id) || null;
      const ac = rat?.linkedFinAcordoId
        ? finAcordos.find((a) => a.id === rat.linkedFinAcordoId) || null
        : null;
      setForm((prev) => applyAcordoAndRateioToNovacao(prev, ac, rat));
      onNotify?.('Cronograma do rateio aplicado à minuta.', 'success');
    }
  };

  const handleResetBlank = () => {
    setSelectedExtractionId('');
    setSelectedAcordoKey('');
    setForm(createEmptyNovacaoData());
    onNotify?.('Campos limpos para impressão do modelo em branco.', 'info');
  };

  const handlePrint = () => {
    const res = printHtmlDirect(previewHtml, 'portrait');
    if (!res.triggered || res.likelyBlocked) {
      if (isConfissao) {
        generateConfissaoDividaPdf(form);
      } else {
        generateNovacaoPdf(form);
      }
      onNotify?.(
        isConfissao
          ? 'PDF A4 da Confissão de Dívida gerado automaticamente para impressão.'
          : 'PDF A4 da Minuta de Novação gerado automaticamente para impressão.',
        'success'
      );
    }
  };

  const handleDownloadPdf = () => {
    try {
      if (isConfissao) {
        generateConfissaoDividaPdf(form);
        onNotify?.('PDF A4 da Confissão de Dívida baixado com sucesso.', 'success');
      } else {
        generateNovacaoPdf(form);
        onNotify?.('PDF A4 da Minuta de Novação baixado com sucesso.', 'success');
      }
    } catch (err) {
      console.error('Erro ao gerar PDF da minuta:', err);
      onNotify?.('Erro ao gerar PDF. Tente baixar o arquivo HTML.', 'error');
    }
  };

  const handleDownloadHtml = () => {
    const safeClient = (form.clienteNome || 'modelo')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_|_$/g, '');
    const prefix = isConfissao ? 'confissao_divida' : 'termo_novacao';
    downloadHtmlFile(previewHtml, `${prefix}_${safeClient || 'padrao'}.html`);
    onNotify?.('Minuta exportada em HTML.', 'success');
  };

  const inputClass =
    'w-full h-9 px-3 bg-[#f7f8fb] border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#4f46e5] focus:bg-white transition-colors';
  const labelClass = 'block text-[11px] font-semibold text-slate-600 mb-1';

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] border border-slate-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${isConfissao ? 'bg-slate-900 text-white' : 'bg-[#eef0ff] text-[#4338ca]'}`}>
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-extrabold text-[#111827] truncate">
                {isConfissao
                  ? 'Instrumento Particular de Confissão de Dívida e Parcelamento'
                  : 'Termo de Novação e Confissão de Dívida'}
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 truncate">
                {isConfissao
                  ? 'Identidade visual do Contrato de Corretagem • Art. 361 CC (sem novação)'
                  : 'Minuta padrão • Rodolfo Jerry Imóveis Sociedade Unipessoal Ltda'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar minuta"
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-toolbar: Document Switcher + Tabs + Quick Actions */}
        <div className="px-4 sm:px-6 py-2.5 bg-[#f7f8fb] border-b border-slate-200/75 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* Switcher entre Novação e Confissão de Dívida */}
            <div className="inline-flex items-center bg-white border border-slate-200/80 rounded-xl p-1 gap-1">
              <button
                type="button"
                onClick={() => setDocType('novacao')}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                  !isConfissao
                    ? 'bg-[#4f46e5] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Novação
              </button>
              <button
                type="button"
                onClick={() => setDocType('confissao')}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                  isConfissao
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Confissão de Dívida
              </button>
            </div>

            <div className="inline-flex items-center bg-white border border-slate-200/80 rounded-xl p-1 gap-1">
              <button
                type="button"
                onClick={() => setActiveTab('form')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  activeTab === 'form'
                    ? 'bg-[#4f46e5] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Dados</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  activeTab === 'preview'
                    ? 'bg-[#4f46e5] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Prévia A4</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetBlank}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Modelo em Branco</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Baixar PDF</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadHtml}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden md:inline">HTML</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#5442f5] hover:bg-[#4634e6] text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir Minuta</span>
            </button>
          </div>
        </div>

        {/* Body */}
        {activeTab === 'form' ? (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
            {/* Importar dados existentes */}
            {(savedExtractions.length > 0 || finAcordos.length > 0 || acordoRateios.length > 0) && (
              <div className="bg-[#f7f8fb] border border-slate-200/80 rounded-2xl p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Importar Cliente e Imóvel de Proposta Salva</label>
                  <select
                    value={selectedExtractionId}
                    onChange={(e) => handleSelectExtraction(e.target.value)}
                    className={inputClass + ' bg-white'}
                  >
                    <option value="">Selecionar proposta salva...</option>
                    {savedExtractions.map((ext) => {
                      const cli = ext.customers?.[0]?.nome || 'Sem cliente';
                      const emp = ext.property?.empreendimento || 'Sem empreendimento';
                      const un = ext.property?.unidade ? ` Un. ${ext.property.unidade}` : '';
                      return (
                        <option key={ext.id} value={ext.id}>
                          {cli} — {emp}
                          {un}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Importar Valores de Acordo / Rateio</label>
                  <select
                    value={selectedAcordoKey}
                    onChange={(e) => handleSelectAcordoOrRateio(e.target.value)}
                    className={inputClass + ' bg-white'}
                  >
                    <option value="">Selecionar acordo ou rateio...</option>
                    {finAcordos.map((ac) => (
                      <option key={`fin:${ac.id}`} value={`fin:${ac.id}`}>
                        Acordo: {ac.beneficiario} ({ac.referencia || 'Sem ref.'}) — R${' '}
                        {formatCurrencyNumberBR(ac.valor)}
                      </option>
                    ))}
                    {acordoRateios.map((rat) => (
                      <option key={`rat:${rat.id}`} value={`rat:${rat.id}`}>
                        Rateio: {rat.titulo} ({rat.referencia || 'Sem ref.'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* 1. Qualificação */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#4f46e5]" />
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                    1. Qualificação do(s) Devedor(es)
                  </h4>
                </div>
                <div className="inline-flex items-center bg-[#f7f8fb] border border-slate-200 rounded-xl p-0.5">
                  <button
                    type="button"
                    onClick={() => updateField('isCasado', false)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                      !form.isCasado
                        ? 'bg-[#4f46e5] text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <User className="w-3 h-3" />
                    <span>Solteiro(a) (1 Devedor)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => updateField('isCasado', true)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                      form.isCasado
                        ? 'bg-[#4f46e5] text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Users className="w-3 h-3" />
                    <span>Casado(a) (2 Devedores)</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className={labelClass}>
                    {form.isCasado ? 'Primeiro Devedor — Nome Completo' : 'Devedor — Nome Completo'}
                  </label>
                  <input
                    type="text"
                    value={form.clienteNome}
                    onChange={(e) => updateField('clienteNome', e.target.value)}
                    placeholder="Nome completo do devedor"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Nacionalidade</label>
                  <input
                    type="text"
                    value={form.clienteNacionalidade}
                    onChange={(e) => updateField('clienteNacionalidade', e.target.value)}
                    placeholder="brasileiro(a)"
                    className={inputClass}
                  />
                </div>
                {!form.isCasado && (
                  <div>
                    <label className={labelClass}>Estado Civil</label>
                    <input
                      type="text"
                      value={form.clienteEstadoCivil}
                      onChange={(e) => updateField('clienteEstadoCivil', e.target.value)}
                      placeholder="solteiro(a), divorciado(a)..."
                      className={inputClass}
                    />
                  </div>
                )}
                <div>
                  <label className={labelClass}>Profissão</label>
                  <input
                    type="text"
                    value={form.clienteProfissao}
                    onChange={(e) => updateField('clienteProfissao', e.target.value)}
                    placeholder="Ex: Engenheiro Civil"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>RG</label>
                  <input
                    type="text"
                    value={form.clienteRg}
                    onChange={(e) => updateField('clienteRg', e.target.value)}
                    placeholder="00.000.000-0"
                    className={inputClass + ' font-mono'}
                  />
                </div>
                <div>
                  <label className={labelClass}>Órgão Expedidor</label>
                  <input
                    type="text"
                    value={form.clienteOrgaoExpedidor}
                    onChange={(e) => updateField('clienteOrgaoExpedidor', e.target.value)}
                    placeholder="SSP/SP"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>CPF / CNPJ</label>
                  <input
                    type="text"
                    value={form.clienteCpf}
                    onChange={(e) => updateField('clienteCpf', e.target.value)}
                    placeholder="000.000.000-00"
                    className={inputClass + ' font-mono'}
                  />
                </div>
                <div>
                  <label className={labelClass}>Telefone</label>
                  <input
                    type="text"
                    value={form.clienteTelefone}
                    onChange={(e) => updateField('clienteTelefone', e.target.value)}
                    placeholder="(11) 99999-9999"
                    className={inputClass + ' font-mono'}
                  />
                </div>
                <div>
                  <label className={labelClass}>E-mail</label>
                  <input
                    type="email"
                    value={form.clienteEmail}
                    onChange={(e) => updateField('clienteEmail', e.target.value)}
                    placeholder="email@exemplo.com"
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className={labelClass}>
                    {form.isCasado
                      ? 'Endereço Residencial de Ambos (logradouro, nº, complemento, bairro, cidade/UF, CEP)'
                      : 'Endereço Residencial Completo'}
                  </label>
                  <input
                    type="text"
                    value={form.clienteResidencial}
                    onChange={(e) => updateField('clienteResidencial', e.target.value)}
                    placeholder="Rua Exemplo, nº 100, Apto 12, Bairro, São Paulo/SP, CEP 00000-000"
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Segundo Devedor (Cônjuge) */}
              {form.isCasado && (
                <div className="mt-3 pt-3 border-t border-dashed border-slate-200 space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#4338ca]">
                    Segundo Devedor (Cônjuge)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Nome Completo do Cônjuge</label>
                      <input
                        type="text"
                        value={form.conjugeNome}
                        onChange={(e) => updateField('conjugeNome', e.target.value)}
                        placeholder="Nome completo do segundo devedor"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Nacionalidade</label>
                      <input
                        type="text"
                        value={form.conjugeNacionalidade}
                        onChange={(e) => updateField('conjugeNacionalidade', e.target.value)}
                        placeholder="brasileiro(a)"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Profissão</label>
                      <input
                        type="text"
                        value={form.conjugeProfissao}
                        onChange={(e) => updateField('conjugeProfissao', e.target.value)}
                        placeholder="Profissão"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>RG</label>
                      <input
                        type="text"
                        value={form.conjugeRg}
                        onChange={(e) => updateField('conjugeRg', e.target.value)}
                        placeholder="00.000.000-0"
                        className={inputClass + ' font-mono'}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Órgão Expedidor</label>
                      <input
                        type="text"
                        value={form.conjugeOrgaoExpedidor}
                        onChange={(e) => updateField('conjugeOrgaoExpedidor', e.target.value)}
                        placeholder="SSP/SP"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>CPF</label>
                      <input
                        type="text"
                        value={form.conjugeCpf}
                        onChange={(e) => updateField('conjugeCpf', e.target.value)}
                        placeholder="000.000.000-00"
                        className={inputClass + ' font-mono'}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Telefone</label>
                      <input
                        type="text"
                        value={form.conjugeTelefone}
                        onChange={(e) => updateField('conjugeTelefone', e.target.value)}
                        placeholder="(11) 99999-9999"
                        className={inputClass + ' font-mono'}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>E-mail</label>
                      <input
                        type="email"
                        value={form.conjugeEmail}
                        onChange={(e) => updateField('conjugeEmail', e.target.value)}
                        placeholder="conjuge@exemplo.com"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* 2. Imóvel e Contrato Originário */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                <Building2 className="w-4 h-4 text-[#4f46e5]" />
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                  2. Imóvel e Contrato Originário
                </h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className={labelClass}>Empreendimento</label>
                  <input
                    type="text"
                    value={form.empreendimentoNome}
                    onChange={(e) => updateField('empreendimentoNome', e.target.value)}
                    placeholder="Nome do empreendimento"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Unidade</label>
                  <input
                    type="text"
                    value={form.unidadeNumero}
                    onChange={(e) => updateField('unidadeNumero', e.target.value)}
                    placeholder="Ex: 402"
                    className={inputClass + ' font-mono'}
                  />
                </div>
                <div>
                  <label className={labelClass}>Divisão / Torre / Bloco</label>
                  <input
                    type="text"
                    value={form.divisaoNome}
                    onChange={(e) => updateField('divisaoNome', e.target.value)}
                    placeholder="Ex: Torre A"
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Endereço do Empreendimento</label>
                  <input
                    type="text"
                    value={form.empreendimentoEndereco}
                    onChange={(e) => updateField('empreendimentoEndereco', e.target.value)}
                    placeholder="Logradouro, nº, bairro, cidade/UF"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Data do Contrato / Venda</label>
                  <input
                    type="text"
                    value={form.vendaData}
                    onChange={(e) => updateField('vendaData', e.target.value)}
                    placeholder="dd/mm/aaaa"
                    className={inputClass + ' font-mono'}
                  />
                </div>
              </div>
            </section>

            {/* 3. Valores da Dívida e Parcelamento */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                <Calculator className="w-4 h-4 text-[#4f46e5]" />
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                  {isConfissao
                    ? '3. Valores da Confissão de Dívida e Parcelamento'
                    : '3. Valores da Dívida, Novação e Parcelamento'}
                </h4>
              </div>

              {isConfissao ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Valor Total da Dívida Confessada (R$)</label>
                    <input
                      type="text"
                      value={form.valorDividaOriginal}
                      onChange={(e) => updateField('valorDividaOriginal', e.target.value)}
                      placeholder="Ex: 25.000,00"
                      className={inputClass + ' font-mono'}
                    />
                    {valOriginalNum > 0 && (
                      <p className="mt-1 text-[11px] text-[#4338ca] font-medium">
                        Por extenso: {valorPorExtensoBRL(valOriginalNum)}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>Data de Vencimento Original (Cláusulas 2.1 e 3.1.c)</label>
                    <input
                      type="text"
                      value={form.dataVencimentoOriginal}
                      onChange={(e) => updateField('dataVencimentoOriginal', e.target.value)}
                      placeholder="dd/mm/aaaa"
                      className={inputClass + ' font-mono'}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>a) Sinal / 1ª Parcela — Valor (R$)</label>
                    <input
                      type="text"
                      value={form.valorEntrada}
                      onChange={(e) => updateField('valorEntrada', e.target.value)}
                      placeholder="Ex: 5.000,00"
                      className={inputClass + ' font-mono'}
                    />
                    {valorEntradaNum > 0 && (
                      <p className="mt-1 text-[11px] text-[#4338ca] font-medium">
                        Por extenso: {valorPorExtensoBRL(valorEntradaNum)}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>a) Vencimento do Sinal / 1ª Parcela</label>
                    <input
                      type="text"
                      value={form.dataVencimento1}
                      onChange={(e) => updateField('dataVencimento1', e.target.value)}
                      placeholder="dd/mm/aaaa"
                      className={inputClass + ' font-mono'}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>b) Qtd. de Parcelas Restantes (Saldo Remanescente)</label>
                    <input
                      type="number"
                      min={1}
                      value={form.qtdParcelasRestantes}
                      onChange={(e) => updateField('qtdParcelasRestantes', e.target.value)}
                      placeholder="Ex: 10"
                      className={inputClass + ' font-mono'}
                    />
                    {qtdRestantesNum > 0 && (
                      <p className="mt-1 text-[11px] text-[#4338ca] font-medium">
                        Por extenso: {numeroPorExtensoPtBr(qtdRestantesNum, true)}{' '}
                        {qtdRestantesNum === 1 ? 'parcela' : 'parcelas'}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>b) Valor de Cada Parcela Restante (R$)</label>
                    <input
                      type="text"
                      value={form.valorParcelaRestante}
                      onChange={(e) => updateField('valorParcelaRestante', e.target.value)}
                      placeholder="Ex: 2.000,00"
                      className={inputClass + ' font-mono'}
                    />
                    {valorParcelaRestanteNum > 0 && (
                      <p className="mt-1 text-[11px] text-[#4338ca] font-medium">
                        Por extenso: {valorPorExtensoBRL(valorParcelaRestanteNum)}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>b) Vencimento da 1ª Parcela Restante</label>
                    <input
                      type="text"
                      value={form.dataVencimento2}
                      onChange={(e) => updateField('dataVencimento2', e.target.value)}
                      placeholder="dd/mm/aaaa"
                      className={inputClass + ' font-mono'}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Data da Assinatura (São Paulo/SP)</label>
                    <input
                      type="text"
                      value={form.dataAssinatura}
                      onChange={(e) => updateField('dataAssinatura', e.target.value)}
                      placeholder="Ex: 20 de novembro de 2026"
                      className={inputClass}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Valor da Dívida Original (R$)</label>
                    <input
                      type="text"
                      value={form.valorDividaOriginal}
                      onChange={(e) => updateField('valorDividaOriginal', e.target.value)}
                      placeholder="Ex: 25.000,00"
                      className={inputClass + ' font-mono'}
                    />
                    {valOriginalNum > 0 && (
                      <p className="mt-1 text-[11px] text-[#4338ca] font-medium">
                        Por extenso: {valorPorExtensoBRL(valOriginalNum)}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>Novo Valor da Dívida Novada (R$)</label>
                    <input
                      type="text"
                      value={form.novoValor}
                      onChange={(e) => updateField('novoValor', e.target.value)}
                      placeholder="Ex: 20.000,00"
                      className={inputClass + ' font-mono'}
                    />
                    {novoValorNum > 0 && (
                      <p className="mt-1 text-[11px] text-[#4338ca] font-medium">
                        Por extenso: {valorPorExtensoBRL(novoValorNum)}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>Quantidade de Parcelas Mensais</label>
                    <input
                      type="number"
                      min={1}
                      value={form.quantidadeParcelas}
                      onChange={(e) => updateField('quantidadeParcelas', e.target.value)}
                      placeholder="Ex: 10"
                      className={inputClass + ' font-mono'}
                    />
                    {qtdParcelasNum > 0 && (
                      <p className="mt-1 text-[11px] text-[#4338ca] font-medium">
                        Por extenso: {numeroPorExtensoPtBr(qtdParcelasNum, true)}{' '}
                        {qtdParcelasNum === 1 ? 'parcela' : 'parcelas'}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>Valor de Cada Parcela (R$)</label>
                    <input
                      type="text"
                      value={form.valorParcela}
                      onChange={(e) => updateField('valorParcela', e.target.value)}
                      placeholder="Ex: 2.000,00"
                      className={inputClass + ' font-mono'}
                    />
                    {valorParcelaNum > 0 && (
                      <p className="mt-1 text-[11px] text-[#4338ca] font-medium">
                        Por extenso: {valorPorExtensoBRL(valorParcelaNum)}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>Data do Primeiro Vencimento</label>
                    <input
                      type="text"
                      value={form.dataPrimeiroVencimento}
                      onChange={(e) => updateField('dataPrimeiroVencimento', e.target.value)}
                      placeholder="dd/mm/aaaa"
                      className={inputClass + ' font-mono'}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Data da Assinatura (São Paulo/SP)</label>
                    <input
                      type="text"
                      value={form.dataAssinatura}
                      onChange={(e) => updateField('dataAssinatura', e.target.value)}
                      placeholder="Ex: 20 de novembro de 2026"
                      className={inputClass}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Representante da Credora (opcional)</label>
                    <input
                      type="text"
                      value={form.credoraRepresentante}
                      onChange={(e) => updateField('credoraRepresentante', e.target.value)}
                      placeholder="Deixe em branco para imprimir linha preenchível"
                      className={inputClass}
                    />
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden bg-slate-200/75 p-3 sm:p-5 flex justify-center">
            <div className="w-full max-w-[794px] h-full bg-white rounded-xl shadow-lg border border-slate-300 overflow-hidden">
              <iframe
                title={
                  isConfissao
                    ? 'Prévia do Instrumento Particular de Confissão de Dívida e Parcelamento'
                    : 'Prévia da Minuta de Novação e Confissão de Dívida'
                }
                srcDoc={previewHtml}
                sandbox=""
                className="w-full h-full min-h-[60vh] border-0 bg-white"
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 bg-white border-t border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] text-slate-500">
            {isConfissao
              ? 'Cláusulas 1 a 4 — Sem novação (Art. 361 CC e Art. 784, III e § 4º CPC) • Visual do Contrato de Corretagem.'
              : 'Cláusulas 1 a 8 conforme minuta padrão (Art. 360 CC e Art. 784, III e § 4º CPC).'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Baixar PDF (A4)</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-white text-xs font-bold shadow-xs transition-colors cursor-pointer ${
                isConfissao
                  ? 'bg-slate-900 hover:bg-slate-800'
                  : 'bg-[#5442f5] hover:bg-[#4634e6]'
              }`}
            >
              <Printer className="w-3.5 h-3.5" />
              <span>
                {isConfissao ? 'Imprimir Confissão de Dívida' : 'Imprimir Novação/Parcelamento'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
