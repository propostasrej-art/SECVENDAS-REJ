import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  Header,
  Footer,
  PageNumber,
  PageBreak,
  ImageRun
} from 'docx';
import { saveAs } from 'file-saver';
import { ExtractionResult, SavedExtraction } from '../types';
import { ensureLogoRjBytes } from './logoAsset';

export interface WaterfallResult {
  passivoTotal?: number;
  participantes?: any[];
  detalhesParcelas?: any[];
}

const formatCurrency = (val?: number): string => {
  if (val === undefined || val === null || isNaN(val)) return 'R$ 0,00';
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const isImobiliariaRole = (role?: string) => {
  if (!role) return false;
  const r = role.toLowerCase();
  return r.includes('imobiliaria') || r.includes('imobiliária') || r.includes('house') || r.includes('r&j') || r.includes('pj');
};

export interface GenerateDocxOptions {
  data: ExtractionResult | SavedExtraction;
  signersList?: any[];
  cargosList?: any[];
  waterfall?: WaterfallResult | any;
  commissionedParties?: any[];
}

export async function generateDocxContract(options: GenerateDocxOptions): Promise<void> {
  const { data, signersList, cargosList = [], waterfall, commissionedParties = [] } = options;

  if (!data) return;

  const isNfRepasse = ((data as any).tipo_minuta_corretagem === 'NF_REPASSE') || 
                      (data.forma_pagamento_comissao === 'NF/REPASSE');

  const property: any = (data as any).property || {};
  const address: any = (data as any).address || {};
  const rawCustomers: any[] = (data as any).customers && (data as any).customers.length > 0
    ? (data as any).customers
    : [(data as any).customer].filter(Boolean);
  const customers = rawCustomers.length > 0 ? rawCustomers : [{}];
  const firstCustomer: any = customers[0] || {};
  const secondCustomer: any = customers[1] || null;

  const effectiveSigners = signersList && signersList.length > 0 ? signersList : [];

  // Sincronizar dados cadastrais dos clientes a partir dos signatários
  if (effectiveSigners.length > 0) {
    const clientSigners = effectiveSigners.filter((s: any) => {
      const r = (s.role || '').toLowerCase();
      return r.includes('contratante') || r.includes('cliente') || r.includes('comprador');
    });
    if (clientSigners[0]) {
      if (clientSigners[0].name?.trim()) firstCustomer.nome = clientSigners[0].name.trim();
      if (clientSigners[0].cpf?.trim()) firstCustomer.cpf = clientSigners[0].cpf.trim();
      if (clientSigners[0].email?.trim()) firstCustomer.email = clientSigners[0].email.trim();
    }
    if (clientSigners[1] && secondCustomer) {
      if (clientSigners[1].name?.trim()) secondCustomer.nome = clientSigners[1].name.trim();
      if (clientSigners[1].cpf?.trim()) secondCustomer.cpf = clientSigners[1].cpf.trim();
      if (clientSigners[1].email?.trim()) secondCustomer.email = clientSigners[1].email.trim();
    }
  }

  const salesTeam: any = (data as any).salesTeam || (data as any).sales_team || {};

  // Local e data de assinatura (prioritariamente a Cidade e Estado do Empreendimento)
  const empCidade = String(
    property.cidade || 
    (data as any).property?.cidade || 
    address.cidade || 
    (data as any).address?.cidade || 
    (firstCustomer?.address as any)?.cidade || 
    'São Paulo'
  ).trim();

  const empEstado = String(
    property.estado || 
    (data as any).property?.estado || 
    address.estado || 
    (data as any).address?.estado || 
    (firstCustomer?.address as any)?.estado || 
    'SP'
  ).trim().toUpperCase();

  const dataExtenso = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const localAssinatura = `${empCidade} - ${empEstado}`;

  // Mapear cargos e nomes flegados para ocultar no rateio
  const rawPartiesForHideCheck = [
    ...((data as any).commissioned_parties || []),
    ...((data as any).commissionedParties || []),
    ...((data as any).manual_waterfall?.participantes || []),
    ...(waterfall?.participantes || []),
    ...(commissionedParties || [])
  ];

  const hiddenRolesSet = new Set<string>();
  const visibleRolesSet = new Set<string>();
  const hiddenRoleAndNameSet = new Set<string>();

  rawPartiesForHideCheck.forEach((p: any) => {
    const rNorm = p.role ? p.role.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() : '';
    if (!rNorm) return;
    if (p.hideAndSum) {
      hiddenRolesSet.add(rNorm);
      if (p.name) {
        p.name.split(',').forEach((n: string) => {
          const nNorm = n.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          if (nNorm) hiddenRoleAndNameSet.add(`${rNorm}:::${nNorm}`);
        });
      }
    } else {
      visibleRolesSet.add(rNorm);
    }
  });

  const isPartyHidden = (role?: string, name?: string, partyObj?: any): boolean => {
    if (partyObj && typeof partyObj.hideAndSum === 'boolean') {
      return partyObj.hideAndSum;
    }
    if (role && isImobiliariaRole(role)) return false;
    if (name && isImobiliariaRole(name)) return false;

    const roleNorm = role ? role.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() : '';
    const nameNorm = name ? name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() : '';

    if (roleNorm && nameNorm && hiddenRoleAndNameSet.has(`${roleNorm}:::${nameNorm}`)) return true;
    if (roleNorm && !visibleRolesSet.has(roleNorm)) {
      if (hiddenRolesSet.has(roleNorm)) return true;
      for (const hr of hiddenRolesSet) {
        if (hr === roleNorm) return true;
        const numRole = roleNorm.match(/\b([0-9]+)\b/)?.[1];
        const numHr = hr.match(/\b([0-9]+)\b/)?.[1];
        if (numRole && numHr && numRole !== numHr) {
          continue;
        }
        if (roleNorm.includes(hr) || hr.includes(roleNorm)) {
          return true;
        }
      }
    }
    return false;
  };

  // Calcular comissão total e participantes
  const comissaoTotal = waterfall?.passivoTotal || (data as any).valorTotalComissao || 0;

  // 1. Participantes ativos no rateio (Anexo - Tabela de Rateio Geral)
  let activeParticipants: any[] = [];
  if (waterfall && waterfall.participantes && waterfall.participantes.length > 0) {
    activeParticipants = waterfall.participantes.filter((p: any) => !p.hideAndSum && !isPartyHidden(p.role, p.name, p));
  } else if (commissionedParties && commissionedParties.length > 0) {
    activeParticipants = commissionedParties.filter((p: any) => !p.hideAndSum && !isPartyHidden(p.role, p.name, p));
  } else {
    activeParticipants = [
      { name: 'R&J Soluções Imobiliárias', role: 'Imobiliária', teto: comissaoTotal },
      { name: salesTeam.corretor1 || 'Corretor 1', role: 'Corretor 1', teto: 0 }
    ];
  }

  if (!activeParticipants.some(p => isImobiliariaRole(p.role))) {
    activeParticipants.unshift({
      role: 'Imobiliária',
      name: 'R&J SOLUÇÕES IMOBILIÁRIAS LTDA',
      teto: 0
    });
  }

  // 2. Beneficiários não ocultos para a Tabela do Item 5 (Credenciais dos Participantes)
  const activeParticipantsList: Array<{
    nome: string;
    apelido: string;
    cpf: string;
    creci: string;
    cargo: string;
  }> = [];

  const effectiveCommissionedParties = [
    ...((waterfall && waterfall.participantes) || []),
    ...((data as any).manual_waterfall?.participantes || []),
    ...((data as any).commissioned_parties || []),
    ...((data as any).commissionedParties || []),
    ...(commissionedParties || [])
  ];

  const activeParties = effectiveCommissionedParties.filter((p: any) => {
    if (p.hideAndSum) return false;
    if (isPartyHidden(p.role, p.name, p)) return false;
    const rLower = (p.role || '').toLowerCase().trim();
    if (rLower === 'imobiliária' || rLower === 'imobiliaria') return false;
    return true;
  });

  activeParties.forEach((p: any) => {
    let rawName = p.name ? String(p.name).trim() : '';
    if (!rawName || rawName.includes('___')) {
      const roleLower = (p.role || '').toLowerCase().trim();
      if (roleLower.includes('corretor 1') && salesTeam.corretor1) rawName = salesTeam.corretor1;
      else if (roleLower.includes('corretor 2') && salesTeam.corretor2) rawName = salesTeam.corretor2;
      else if (roleLower.includes('gerente') && salesTeam.gerente) rawName = salesTeam.gerente;
      else if (roleLower.includes('diretor') && salesTeam.diretor) rawName = salesTeam.diretor;
      else if (roleLower.includes('coordenador') && salesTeam.coordenador) rawName = salesTeam.coordenador;
      else {
        const matchCargo = cargosList.find((c: any) => (c.cargo || '').toLowerCase().trim() === roleLower);
        if (matchCargo) rawName = matchCargo.nome;
        else rawName = p.role || 'Participante';
      }
    }

    const names = rawName.split(',');
    names.forEach((n: string) => {
      const nameTrimmed = n.trim();
      if (!nameTrimmed) return;

      const existing = activeParticipantsList.find(ap => ap.nome.toLowerCase().trim() === nameTrimmed.toLowerCase());
      if (existing) {
        const currentRoles = existing.cargo.split(',').map((r: string) => r.trim().toLowerCase());
        if (p.role && !currentRoles.includes(p.role.trim().toLowerCase())) {
          existing.cargo = `${existing.cargo}, ${p.role.trim()}`;
        }
        return;
      }

      const match = cargosList.find((c: any) => 
        (c.nome && c.nome.toLowerCase().trim() === nameTrimmed.toLowerCase()) ||
        (c.apelido && c.apelido.toLowerCase().trim() === nameTrimmed.toLowerCase())
      ) || cargosList.find((c: any) => 
        c.nome && c.nome.toLowerCase().trim().startsWith(nameTrimmed.toLowerCase())
      );

      if (match) {
        activeParticipantsList.push({
          nome: match.nome,
          apelido: match.apelido || nameTrimmed.split(' ')[0],
          cpf: match.cpf_cnpj || '-',
          creci: match.creci || '-',
          cargo: p.role || match.cargo
        });
      } else {
        activeParticipantsList.push({
          nome: nameTrimmed,
          apelido: nameTrimmed.split(' ')[0],
          cpf: '-',
          creci: '-',
          cargo: p.role || 'Beneficiário'
        });
      }
    });
  });

  if (effectiveSigners.length > 0) {
    effectiveSigners.forEach((sig: any) => {
      if (!sig.name || sig.name.includes('___')) return;
      const match = activeParticipantsList.find(ap => 
        ap.nome.toLowerCase().trim() === sig.name.toLowerCase().trim() ||
        ap.apelido.toLowerCase().trim() === sig.name.toLowerCase().trim()
      );
      if (match) {
        if (sig.cpf && sig.cpf.trim() && (match.cpf === '-' || !match.cpf)) match.cpf = sig.cpf.trim();
        if (sig.creci && sig.creci.trim() && (match.creci === '-' || !match.creci)) match.creci = sig.creci.trim();
      }
    });
  }

  const getParticipantApelido = (name: string): string => {
    if (!name) return '';
    const match = cargosList.find((c: any) => {
      const cNome = (c.nome || '').toLowerCase().trim();
      const cApelido = (c.apelido || '').toLowerCase().trim();
      const search = name.toLowerCase().trim();
      return cNome === search || cApelido === search;
    });
    return match?.apelido || name.split(' ')[0] || name;
  };

  // Processar parcelas para a Tabela de Rateio Geral (Auditoria de Fluxo)
  const parcelasSrc = waterfall?.detalhesParcelas || [];
  const rateioGeralParcelas: any[] = [];
  let runningSum = 0;

  for (let idx = 0; idx < parcelasSrc.length; idx++) {
    const det = parcelasSrc[idx];
    const sumDist: number = Number(Object.values(det.distribuicao || {}).reduce((acc: number, v: any) => acc + (Number(v) || 0), 0));
    const retencao: number = Number(det.valorRetido !== undefined ? det.valorRetido : ((det as any).retencao || 0)) || 0;
    let valToShow: number = sumDist > 0.005 ? Number(sumDist.toFixed(2)) : retencao;

    if (valToShow > 0.005) {
      rateioGeralParcelas.push({
        ...det,
        vencimentoToShow: det.vencimento || '-',
        valorComissaoToShow: valToShow
      });
      runningSum = Number((runningSum + valToShow).toFixed(2));
    }

    if (runningSum >= comissaoTotal - 0.01 && comissaoTotal > 0) {
      break;
    }
  }

  if (rateioGeralParcelas.length === 0 && parcelasSrc.length > 0) {
    parcelasSrc.forEach((det: any) => {
      const sumDist: number = Number(Object.values(det.distribuicao || {}).reduce((acc: number, v: any) => acc + (Number(v) || 0), 0));
      const retencao: number = Number(det.valorRetido !== undefined ? det.valorRetido : ((det as any).retencao || 0)) || 0;
      const val: number = sumDist > 0.005 ? Number(sumDist.toFixed(2)) : retencao;
      if (val > 0.005) {
        rateioGeralParcelas.push({
          ...det,
          vencimentoToShow: det.vencimento || '-',
          valorComissaoToShow: val
        });
      }
    });
  }

  const totalComissaoRateioGeral = rateioGeralParcelas.reduce((acc, d) => acc + d.valorComissaoToShow, 0);

  // Nome do arquivo de saída
  const empClean = (property.empreendimento || 'EMPREENDIMENTO').replace(/[^a-zA-Z0-9_-]/g, '_');
  const undClean = (property.unidade || 'UNIDADE').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `CONTRATO_CORRETAGEM_${empClean}_${undClean}.docx`;

  // Estilos de borda padrão para tabelas
  const tableCellBorder = {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }
  };

  // Testemunhas Instrumentárias
  const witnesses = effectiveSigners.filter((s: any) => (s.role || '').toLowerCase().includes('testemunha'));
  const w1 = witnesses[0];
  const w2 = witnesses[1];

  const w1Name = w1 && !w1.name.includes('(Opcional)') && w1.name.trim() ? w1.name.trim() : 'SAMUEL CERQUEIRA';
  const w1Cpf = w1?.cpf?.trim() ? `CPF: ${w1.cpf.trim()}` : 'CPF: ___________________';
  
  const w2Name = w2 && !w2.name.includes('(Opcional)') && w2.name.trim() ? w2.name.trim() : 'Testemunha 2';
  const w2Cpf = w2?.cpf?.trim() ? `CPF: ${w2.cpf.trim()}` : 'CPF: ___________________';

  // Logo R&J como ImageRun (168x168 -> proporção 1:1)
  let logoImageRun: ImageRun | null = null;
  try {
    const logoBytes = await ensureLogoRjBytes();
    if (logoBytes) {
      logoImageRun = new ImageRun({
        data: logoBytes,
        type: 'png',
        transformation: {
          width: 72,
          height: 72
        }
      });
    }
  } catch (e) {
    console.warn("Logo R&J não pôde ser carregada no Word docx:", e);
  }

  // --- MONTAGEM DO DOCUMENTO DOCX ---
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 19, // ~9.5pt
            color: '1E293B'
          },
          paragraph: {
            spacing: { line: 260, after: 120 }
          }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1080, // 15mm ~ 1080 dxa
              bottom: 1080,
              left: 1080, // 15mm ~ 1080 dxa
              right: 1080
            }
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `R&J SOLUÇÕES IMOBILIÁRIAS | ${property.empreendimento || 'Contrato de Corretagem'}`,
                    size: 15,
                    color: '64748B',
                    bold: true
                  })
                ]
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: 'Página ',
                    size: 15,
                    color: '64748B'
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 15,
                    color: '64748B'
                  }),
                  new TextRun({
                    text: ' de ',
                    size: 15,
                    color: '64748B'
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 15,
                    color: '64748B'
                  })
                ]
              })
            ]
          })
        },
        children: [
          // CABEÇALHO OFICIAL R&J
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 180 },
            children: logoImageRun ? [logoImageRun] : []
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
            children: [
              new TextRun({
                text: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE CORRETAGEM E INTERMEDIAÇÃO IMOBILIÁRIA',
                bold: true,
                size: 24, // 12pt
                color: '0F172A'
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            children: [
              new TextRun({
                text: isNfRepasse ? 'MINUTA OFICIAL – MODALIDADE NOTA FISCAL / REPASSE' : 'MINUTA OFICIAL DE CORRETAGEM – RATEIO DIRETO',
                bold: true,
                size: 17,
                color: '4F46E5'
              })
            ]
          }),

          // CAIXA RESUMO DO IMÓVEL
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
                    borders: tableCellBorder,
                    margins: { top: 120, bottom: 120, left: 160, right: 160 },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({ text: 'EMPREENDIMENTO: ', bold: true, size: 18, color: '0F172A' }),
                          new TextRun({ text: `${property.empreendimento || '-'} | `, size: 18 }),
                          new TextRun({ text: 'UNIDADE: ', bold: true, size: 18, color: '0F172A' }),
                          new TextRun({ text: `${property.unidade || '-'} | `, size: 18 }),
                          new TextRun({ text: 'TORRE/BLOCO: ', bold: true, size: 18, color: '0F172A' }),
                          new TextRun({ text: `${property.torre || '-'}`, size: 18 })
                        ]
                      }),
                      new Paragraph({
                        spacing: { before: 80 },
                        children: [
                          new TextRun({ text: 'VALOR DO IMÓVEL: ', bold: true, size: 18, color: '0F172A' }),
                          new TextRun({ text: `${formatCurrency(data.valorTotalProposta || 0)} | `, size: 18 }),
                          new TextRun({ text: 'VALOR TOTAL DAS COMISSÕES: ', bold: true, size: 18, color: '0F172A' }),
                          new TextRun({ text: `${formatCurrency(comissaoTotal)}`, bold: true, size: 18, color: '0F172A' })
                        ]
                      })
                    ]
                  })
                ]
              })
            ]
          }),

          // SEÇÃO 1: QUALIFICAÇÃO DO(S) COMPRADOR(ES)
          createSectionHeader('1 - QUALIFICAÇÃO DO(S) COMPRADOR(ES) / CONTRATANTE(S)'),
          new Paragraph({
            alignment: AlignmentType.BOTH,
            children: [
              new TextRun({ text: 'COMPRADOR 1: ', bold: true }),
              new TextRun({ text: `${firstCustomer.nome || '________________________'}, ` }),
              new TextRun({ text: `CPF/CNPJ: ${firstCustomer.cpf || '__________________'}, ` }),
              new TextRun({ text: `E-mail: ${firstCustomer.email || '__________________'}, ` }),
              new TextRun({ text: `Telefone: ${firstCustomer.telefone || '__________________'}` })
            ]
          }),
          ...(secondCustomer ? [
            new Paragraph({
              alignment: AlignmentType.BOTH,
              children: [
                new TextRun({ text: 'COMPRADOR 2: ', bold: true }),
                new TextRun({ text: `${secondCustomer.nome || '________________________'}, ` }),
                new TextRun({ text: `CPF/CNPJ: ${secondCustomer.cpf || '__________________'}, ` }),
                new TextRun({ text: `E-mail: ${secondCustomer.email || '__________________'}, ` }),
                new TextRun({ text: `Telefone: ${secondCustomer.telefone || '__________________'}` })
              ]
            })
          ] : []),

          // SEÇÃO 2: EMPREENDIMENTO E UNIDADE IMOBILIÁRIA
          createSectionHeader('2 - OBJETO / EMPREENDIMENTO'),
          new Paragraph({
            alignment: AlignmentType.BOTH,
            children: [
              new TextRun({ text: 'Unidade autônoma nº ' }),
              new TextRun({ text: `${property.unidade || '___'}, `, bold: true }),
              new TextRun({ text: 'Torre/Bloco ' }),
              new TextRun({ text: `${property.torre || '___'}, `, bold: true }),
              new TextRun({ text: 'integrante do Empreendimento ' }),
              new TextRun({ text: `${property.empreendimento || '________________________'}, `, bold: true }),
              new TextRun({ text: `localizado em ${address.cidade || 'São Paulo'} - ${address.estado || 'SP'}.` })
            ]
          }),

          // SEÇÃO 3: VENDEDORA / INCORPORADORA
          createSectionHeader('3 - VENDEDORA / INCORPORADORA'),
          new Paragraph({
            alignment: AlignmentType.BOTH,
            children: [
              new TextRun({ text: 'INCORPORADORA: ', bold: true }),
              new TextRun({ text: `${property.incorporadora || 'SPE INCORPORADORA IMOBILIÁRIA S/A'}, ` }),
              new TextRun({ text: 'empresa responsável pelo desenvolvimento e alienação das unidades do Empreendimento.' })
            ]
          }),

          // SEÇÃO 4: IMOBILIÁRIA INTERMEDIADORA
          createSectionHeader('4 - IMOBILIÁRIA / INTERMEDIADORA'),
          new Paragraph({
            alignment: AlignmentType.BOTH,
            children: [
              new TextRun({ text: 'IMOBILIÁRIA: ', bold: true }),
              new TextRun({ text: 'R&J SOLUÇÕES IMOBILIÁRIAS LTDA., ', bold: true }),
              new TextRun({ text: 'empresa especializada na prestação de serviços de intermediação e coordenação de vendas imobiliárias.' })
            ]
          }),

          // SEÇÃO 5: EQUIPE DE VENDAS E CREDENCIAIS DOS BENEFICIÁRIOS
          createSectionHeader('5 - CREDENCIAIS DOS PARTICIPANTES E BENEFICIÁRIOS NA VENDA'),
          createTeamTable({
            activeParticipantsList,
            tableCellBorder
          }),

          // SEÇÃO 6: CLÁUSULAS CONTRATUAIS
          createSectionHeader('6 - CLÁUSULAS CONTRATUAIS'),
          ...createClausulasContratuais(isNfRepasse),

          // SEÇÃO 7: ASSINATURAS E TESTEMUNHAS
          createSectionHeader('7 - ASSINATURAS E TESTEMUNHAS INSTRUMENTÁRIAS'),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 100, after: 160 },
            children: [
              new TextRun({
                text: `${localAssinatura}, ${dataExtenso}.`,
                bold: true,
                size: 18,
                color: '0F172A'
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.BOTH,
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: 'E, por estarem assim justos e contratados, assinam o presente instrumento por meio de plataforma eletrônica de assinaturas digitais com validade jurídica assegurada pela legislação vigente.',
                italics: true
              })
            ]
          }),

          // TABELA DE ASSINATURAS
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    borders: tableCellBorder,
                    margins: { top: 120, bottom: 120, left: 120, right: 120 },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: 'CONTRATANTE / COMPRADOR 1', bold: true, size: 16 })] }),
                      new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: `Nome: ${firstCustomer.nome || '________________________'}`, size: 16 })] }),
                      new Paragraph({ children: [new TextRun({ text: `CPF: ${firstCustomer.cpf || '__________________'}`, size: 16 })] }),
                      new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: '[Assinatura Eletrônica Pendente / Assinafy]', size: 14, color: '64748B', italics: true })] })
                    ]
                  }),
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    borders: tableCellBorder,
                    margins: { top: 120, bottom: 120, left: 120, right: 120 },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: 'IMOBILIÁRIA / INTERMEDIADORA', bold: true, size: 16 })] }),
                      new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: 'R&J SOLUÇÕES IMOBILIÁRIAS LTDA.', size: 16, bold: true })] }),
                      new Paragraph({ children: [new TextRun({ text: 'CNPJ/CRECI: Responsável Técnico', size: 16 })] }),
                      new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: '[Assinatura Eletrônica Pendente / Assinafy]', size: 14, color: '64748B', italics: true })] })
                    ]
                  })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    borders: tableCellBorder,
                    margins: { top: 120, bottom: 120, left: 120, right: 120 },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: 'TESTEMUNHA 1 (INSTRUMENTÁRIA)', bold: true, size: 16 })] }),
                      new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: `Nome: ${w1Name}`, size: 16, bold: true })] }),
                      new Paragraph({ children: [new TextRun({ text: w1Cpf, size: 16 })] }),
                      new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: '[Assinatura Eletrônica Pendente / Assinafy]', size: 14, color: '64748B', italics: true })] })
                    ]
                  }),
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    borders: tableCellBorder,
                    margins: { top: 120, bottom: 120, left: 120, right: 120 },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: 'TESTEMUNHA 2 (INSTRUMENTÁRIA)', bold: true, size: 16 })] }),
                      new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: `Nome: ${w2Name}`, size: 16 })] }),
                      new Paragraph({ children: [new TextRun({ text: w2Cpf, size: 16 })] }),
                      new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: '[Assinatura Eletrônica Pendente / Assinafy]', size: 14, color: '64748B', italics: true })] })
                    ]
                  })
                ]
              })
            ]
          }),

          // --- PAGE BREAK PARA O ANEXO - TABELA DE RATEIO GERAL ---
          new Paragraph({ children: [new PageBreak()] }),

          // CABEÇALHO DO ANEXO DE RATEIO
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 60 },
            children: [
              new TextRun({
                text: 'ANEXO – TABELA DE RATEIO GERAL',
                bold: true,
                size: 24,
                color: '0F172A'
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: 'CRONOGRAMA DE LIQUIDAÇÃO E AMORTIZAÇÃO DE HONORÁRIOS DE CORRETAGEM (AUDITORIA DE FLUXO)',
                bold: true,
                size: 16,
                color: '4F46E5'
              })
            ]
          }),

          // PAINEL DE INFORMAÇÕES DO ANEXO
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
                    borders: tableCellBorder,
                    margins: { top: 100, bottom: 100, left: 120, right: 120 },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({ text: 'Empreendimento: ', bold: true, size: 16 }),
                          new TextRun({ text: `${property.empreendimento || 'Imóvel'} | `, size: 16 }),
                          new TextRun({ text: 'Unidade: ', bold: true, size: 16 }),
                          new TextRun({ text: `${property.unidade || '-'} | `, size: 16 }),
                          new TextRun({ text: 'Comissão Total: ', bold: true, size: 16, color: '0F172A' }),
                          new TextRun({ text: formatCurrency(comissaoTotal), bold: true, size: 16, color: '0F172A' })
                        ]
                      })
                    ]
                  })
                ]
              })
            ]
          }),

          new Paragraph({ spacing: { after: 120 } }),

          // TABELA DE RATEIO GERAL (LAYOUT AUDITORIA DE FLUXO / WATERFALL)
          createRateioGeralTable({
            activeParticipants,
            rateioGeralParcelas,
            totalComissaoRateioGeral,
            getParticipantApelido
          })
        ]
      }
    ]
  });

  // Gerar o Blob do arquivo .docx e efetuar o download via file-saver
  const buffer = await Packer.toBlob(doc);
  saveAs(buffer, fileName);
}

// Auxiliar para criar a tabela do Item 5 (Credenciais de Todos os Beneficiários)
function createTeamTable(params: {
  activeParticipantsList: Array<{
    nome: string;
    apelido: string;
    cpf: string;
    creci: string;
    cargo: string;
  }>;
  tableCellBorder: any;
}): Table {
  const { activeParticipantsList, tableCellBorder } = params;

  if (activeParticipantsList.length === 0) {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: tableCellBorder,
              margins: { top: 100, bottom: 100, left: 100, right: 100 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: 'Nenhum beneficiário não oculto associado a esta venda.', italics: true, color: '64748B' })]
                })
              ]
            })
          ]
        })
      ]
    });
  }

  const headerRow = new TableRow({
    children: [
      new TableCell({ shading: { fill: '0F172A', type: ShadingType.CLEAR }, borders: tableCellBorder, margins: { top: 80, bottom: 80, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: 'NOME DO BENEFICIÁRIO', bold: true, color: 'FFFFFF', size: 14 })] })] }),
      new TableCell({ shading: { fill: '0F172A', type: ShadingType.CLEAR }, borders: tableCellBorder, margins: { top: 80, bottom: 80, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: 'APELIDO', bold: true, color: 'FFFFFF', size: 14 })] })] }),
      new TableCell({ shading: { fill: '0F172A', type: ShadingType.CLEAR }, borders: tableCellBorder, margins: { top: 80, bottom: 80, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: 'CPF / CNPJ', bold: true, color: 'FFFFFF', size: 14 })] })] }),
      new TableCell({ shading: { fill: '0F172A', type: ShadingType.CLEAR }, borders: tableCellBorder, margins: { top: 80, bottom: 80, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: 'CRECI', bold: true, color: 'FFFFFF', size: 14 })] })] }),
      new TableCell({ shading: { fill: '0F172A', type: ShadingType.CLEAR }, borders: tableCellBorder, margins: { top: 80, bottom: 80, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: 'CARGO NA OPERAÇÃO', bold: true, color: 'FFFFFF', size: 14 })] })] })
    ]
  });

  const dataRows = activeParticipantsList.map((part, idx) => {
    const bgFill = idx % 2 === 0 ? 'FFFFFF' : 'F8FAFC';
    return new TableRow({
      children: [
        new TableCell({ shading: { fill: bgFill, type: ShadingType.CLEAR }, borders: tableCellBorder, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: part.nome, bold: true, size: 14, color: '0F172A' })] })] }),
        new TableCell({ shading: { fill: bgFill, type: ShadingType.CLEAR }, borders: tableCellBorder, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: part.apelido, size: 14, color: '334155' })] })] }),
        new TableCell({ shading: { fill: bgFill, type: ShadingType.CLEAR }, borders: tableCellBorder, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: part.cpf, size: 14, color: '334155' })] })] }),
        new TableCell({ shading: { fill: bgFill, type: ShadingType.CLEAR }, borders: tableCellBorder, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: part.creci, size: 14, color: '334155' })] })] }),
        new TableCell({ shading: { fill: bgFill, type: ShadingType.CLEAR }, borders: tableCellBorder, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: part.cargo, bold: true, size: 14, color: '4F46E5' })] })] })
      ]
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows]
  });
}

// Auxiliar para criar títulos de seção padronizados com fundo azul/slate claro
function createSectionHeader(titleText: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 120 },
    shading: { fill: 'F1F5F9', type: ShadingType.CLEAR },
    border: {
      left: { style: BorderStyle.SINGLE, size: 24, color: '0F172A' }
    },
    indent: { left: 140 },
    children: [
      new TextRun({
        text: `  ${titleText}`,
        bold: true,
        size: 19,
        color: '0F172A'
      })
    ]
  });
}

// Auxiliar para criar cláusulas contratuais justificadas
function createClausulasContratuais(isNfRepasse: boolean): Paragraph[] {
  if (isNfRepasse) {
    return [
      new Paragraph({
        alignment: AlignmentType.BOTH,
        children: [
          new TextRun({ text: '1. ', bold: true }),
          new TextRun({ text: 'O(s) CONTRATANTE(S) deseja(m) adquirir a unidade imobiliária especificada no preâmbulo deste instrumento.' })
        ]
      }),
      new Paragraph({
        alignment: AlignmentType.BOTH,
        children: [
          new TextRun({ text: '2. ', bold: true }),
          new TextRun({ text: 'O(s) CORRETOR(ES) ASSOCIADO(S) qualificados no preâmbulo são profissionais independentes, atuando em parceria para a intermediação do negócio imobiliário, com rateio dos honorários de corretagem nos termos do art. 728 do Código Civil e Lei Federal nº 6.530/1978.' })
        ]
      }),
      new Paragraph({
        alignment: AlignmentType.BOTH,
        children: [
          new TextRun({ text: '3. ', bold: true }),
          new TextRun({ text: 'O(s) CONTRATANTE(S) declaram ter sido previamente informados do valor total do negócio e do montante das comissões devidas aos profissionais participantes.' })
        ]
      }),
      new Paragraph({
        alignment: AlignmentType.BOTH,
        children: [
          new TextRun({ text: '4. ', bold: true }),
          new TextRun({ text: 'O valor da intermediação imobiliária será processado na modalidade Nota Fiscal / Repasse, mediante retenção e repasse aos corretores associados após emissão das notas fiscais correspondentes.' })
        ]
      }),
      new Paragraph({
        alignment: AlignmentType.BOTH,
        children: [
          new TextRun({ text: '5. ', bold: true }),
          new TextRun({ text: 'O presente instrumento consubstancia título executivo extrajudicial nos termos do art. 784, inciso III, do Código de Processo Civil.' })
        ]
      })
    ];
  }

  return [
    new Paragraph({
      alignment: AlignmentType.BOTH,
      children: [
        new TextRun({ text: '1. Do Objeto: ', bold: true }),
        new TextRun({ text: 'O CONTRATANTE manifesta expressamente o interesse e delibera pela aquisição da unidade imobiliária especificada no Item 2 deste instrumento.' })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.BOTH,
      children: [
        new TextRun({ text: '2. Da Natureza dos Profissionais: ', bold: true }),
        new TextRun({ text: 'Os corretores de imóveis e participantes listados atuam de forma autônoma e independente, associando-se para a consecução da intermediação imobiliária, operando o rateio da corretagem em estrita observância ao art. 728 do Código Civil e Lei Federal nº 6.530/1978.' })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.BOTH,
      children: [
        new TextRun({ text: '3. Da Ciência de Preço e Honorários: ', bold: true }),
        new TextRun({ text: 'O CONTRATANTE declara ter tomado ciência prévia inequívoca do custo total da aquisição, estando ciente de que o montante discriminado na tabela anexa sob a rubrica "Valor Total das Comissões" reverte diretamente à remuneração dos intervenientes associados.' })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.BOTH,
      children: [
        new TextRun({ text: '4. Do Título Executivo e Foro: ', bold: true }),
        new TextRun({ text: 'As partes reconhecem o presente instrumento como título executivo extrajudicial (art. 784, III do CPC) e elegem o Foro da Comarca da Capital para dirimir eventuais controvérsias.' })
      ]
    })
  ];
}

// Auxiliar para montar a Tabela de Rateio Geral (Cronograma / Auditoria de Fluxo)
function createRateioGeralTable(params: {
  activeParticipants: any[];
  rateioGeralParcelas: any[];
  totalComissaoRateioGeral: number;
  getParticipantApelido: (name: string) => string;
}): Table {
  const { activeParticipants, rateioGeralParcelas, totalComissaoRateioGeral, getParticipantApelido } = params;

  const cellBorder = {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }
  };

  // 1. LINHA DE CABEÇALHO PRINCIPAL
  const headerRow = new TableRow({
    children: [
      new TableCell({
        columnSpan: 2,
        shading: { fill: '0F172A', type: ShadingType.CLEAR },
        borders: cellBorder,
        margins: { top: 100, bottom: 100, left: 100, right: 100 },
        children: [
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({
                text: 'EVENTO / FLUXO DE RECEBÍVEIS',
                bold: true,
                size: 15,
                color: 'FFFFFF'
              })
            ]
          })
        ]
      }),
      ...activeParticipants.map(p => {
        const roleTitle = isImobiliariaRole(p.role) ? 'Imobiliária' : (p.role || 'Participante');
        return new TableCell({
          shading: { fill: '0F172A', type: ShadingType.CLEAR },
          borders: cellBorder,
          margins: { top: 100, bottom: 100, left: 80, right: 80 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: roleTitle.toUpperCase(),
                  bold: true,
                  size: 14,
                  color: 'FFFFFF'
                })
              ]
            })
          ]
        });
      })
    ]
  });

  // 2. LINHA DE SUB-CABEÇALHO (Apelidos / Nomes dos Credores)
  const subHeaderRow = new TableRow({
    children: [
      new TableCell({
        shading: { fill: '1E293B', type: ShadingType.CLEAR },
        borders: cellBorder,
        margins: { top: 80, bottom: 80, left: 80, right: 80 },
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: 'VALOR RETIDO', bold: true, size: 13, color: 'E2E8F0' })
            ]
          })
        ]
      }),
      new TableCell({
        shading: { fill: '1E293B', type: ShadingType.CLEAR },
        borders: cellBorder,
        margins: { top: 80, bottom: 80, left: 80, right: 80 },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'VENCIMENTO', bold: true, size: 13, color: 'E2E8F0' })
            ]
          })
        ]
      }),
      ...activeParticipants.map(p => {
        const isImob = isImobiliariaRole(p.role) || (p.role || '').toLowerCase().includes('imobili');
        const apelido = isImob ? 'R&J' : (getParticipantApelido(p.name) || (p.name ? p.name.split(' ')[0] : ''));
        return new TableCell({
          shading: { fill: '1E293B', type: ShadingType.CLEAR },
          borders: cellBorder,
          margins: { top: 80, bottom: 80, left: 60, right: 60 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: (apelido || p.role).toUpperCase(), bold: true, size: 13, color: 'E2E8F0' })
              ]
            })
          ]
        });
      })
    ]
  });

  // 3. LINHAS DAS PARCELAS DE CORRETAGEM
  const participantTotals: { [role: string]: number } = {};
  activeParticipants.forEach(p => { participantTotals[p.role] = 0; });

  const dataRows = rateioGeralParcelas.map((det, idx) => {
    const isEven = idx % 2 === 0;
    const bgFill = isEven ? 'FFFFFF' : 'F8FAFC';

    const valorRetido = det.valorComissaoToShow || 0;
    const vencimento = det.vencimentoToShow || '-';

    return new TableRow({
      children: [
        new TableCell({
          shading: { fill: bgFill, type: ShadingType.CLEAR },
          borders: cellBorder,
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: formatCurrency(valorRetido), bold: true, size: 14, color: '0F172A' })
              ]
            })
          ]
        }),
        new TableCell({
          shading: { fill: bgFill, type: ShadingType.CLEAR },
          borders: cellBorder,
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: vencimento, size: 14, color: '334155' })
              ]
            })
          ]
        }),
        ...activeParticipants.map(p => {
          let partVal = 0;
          if (det.distribuicao) {
            if (det.distribuicao[p.role] !== undefined) {
              partVal = Number(det.distribuicao[p.role]) || 0;
            } else {
              const matchingKey = Object.keys(det.distribuicao).find(
                k => k.toLowerCase().trim() === (p.role || '').toLowerCase().trim()
              );
              if (matchingKey) {
                partVal = Number(det.distribuicao[matchingKey]) || 0;
              }
            }
          }

          participantTotals[p.role] = Number(((participantTotals[p.role] || 0) + partVal).toFixed(2));

          const displayStr = partVal > 0.005 ? formatCurrency(partVal) : '-';
          const fontColor = partVal > 0.005 ? '0F172A' : '94A3B8';

          return new TableCell({
            shading: { fill: bgFill, type: ShadingType.CLEAR },
            borders: cellBorder,
            margins: { top: 60, bottom: 60, left: 60, right: 60 },
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: displayStr, bold: partVal > 0.005, size: 13, color: fontColor })
                ]
              })
            ]
          });
        })
      ]
    });
  });

  // 4. LINHA TOTALIZADORA DA TABELA DE RATEIO
  const totalRowBorders = {
    top: { style: BorderStyle.SINGLE, size: 12, color: '0F172A' },
    bottom: { style: BorderStyle.DOUBLE, size: 18, color: '0F172A' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }
  };

  const totalRow = new TableRow({
    children: [
      new TableCell({
        shading: { fill: 'E2E8F0', type: ShadingType.CLEAR },
        borders: totalRowBorders,
        margins: { top: 100, bottom: 100, left: 80, right: 80 },
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: formatCurrency(totalComissaoRateioGeral), bold: true, size: 15, color: '0F172A' })
            ]
          })
        ]
      }),
      new TableCell({
        shading: { fill: 'E2E8F0', type: ShadingType.CLEAR },
        borders: totalRowBorders,
        margins: { top: 100, bottom: 100, left: 80, right: 80 },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'TOTAL', bold: true, size: 15, color: '0F172A' })
            ]
          })
        ]
      }),
      ...activeParticipants.map(p => {
        const totalPart = participantTotals[p.role] || 0;
        return new TableCell({
          shading: { fill: 'E2E8F0', type: ShadingType.CLEAR },
          borders: totalRowBorders,
          margins: { top: 100, bottom: 100, left: 60, right: 60 },
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: formatCurrency(totalPart), bold: true, size: 14, color: '0F172A' })
              ]
            })
          ]
        });
      })
    ]
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, subHeaderRow, ...dataRows, totalRow]
  });
}
