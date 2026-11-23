import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  NovacaoFormData,
  formatCurrencyNumberBR,
  formatDateToBR,
  numeroPorExtensoPtBr,
  parseCurrencyString,
  valorPorExtensoBRL,
} from './novacaoTemplate';
import { DiagnosticoEspecialista, WaterfallResult } from '../lib/waterfallCalculator';
import { addLogoToJsPdf } from './logoAsset';

function unwrapMediaPrintBlocks(css: string): string {
  let result = '';
  let idx = 0;
  const regex = /@media\s+print\s*\{/gi;

  while (idx < css.length) {
    regex.lastIndex = idx;
    const match = regex.exec(css);
    if (!match) {
      result += css.slice(idx);
      break;
    }

    result += css.slice(idx, match.index);
    let depth = 1;
    let cursor = match.index + match[0].length;
    const contentStart = cursor;

    while (cursor < css.length && depth > 0) {
      const ch = css[cursor];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      cursor += 1;
    }

    const inner = depth === 0 ? css.slice(contentStart, cursor - 1) : css.slice(contentStart);
    result += `\n${inner}\n`;
    idx = cursor;
  }

  return result;
}

/**
 * Scopes raw CSS rules from an HTML print document into `#rj-print-portal`
 * so mounting them into the main document never leaks onto the live app UI.
 */
function scopePrintCss(rawCss: string, orientation: 'portrait' | 'landscape'): string {
  const withoutComments = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const preservedAtRules: string[] = [];
  let stripped = withoutComments;

  // Preserve @page rules directly (cannot be prefixed)
  stripped = stripped.replace(/@page\s*[^{]*\{[^}]*\}/gi, (match) => {
    preservedAtRules.push(match);
    return '';
  });

  // Unwrap @media print { ... } with balanced braces so nested rules stay intact
  stripped = unwrapMediaPrintBlocks(stripped);

  // Prefix individual selector blocks with `#rj-print-portal`
  const scopedBlocks = stripped.replace(/([^{}@]+)\{([^{}]*)\}/g, (_full, selectorsRaw: string, body: string) => {
    const selectors = selectorsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((sel) => {
        if (/^(html|body|:root)$/i.test(sel)) return '#rj-print-portal';
        if (/^body\s+/i.test(sel)) return sel.replace(/^body\s+/i, '#rj-print-portal ');
        if (/^html\s+/i.test(sel)) return sel.replace(/^html\s+/i, '#rj-print-portal ');
        if (sel === '*') return '#rj-print-portal, #rj-print-portal *';
        return `#rj-print-portal ${sel}`;
      });
    if (selectors.length === 0) return '';
    return `${selectors.join(', ')} { ${body} }`;
  });

  const defaultPageRule =
    preservedAtRules.length > 0
      ? preservedAtRules.join('\n')
      : `@page { size: A4 ${orientation}; margin: ${orientation === 'landscape' ? '10mm' : '18mm'}; }`;

  return `${defaultPageRule}\n@media print {\n${scopedBlocks}\n}`;
}

/**
 * Synchronous main-window print using `#rj-print-portal` + `window.print()`.
 * Avoids `window.open` (blocked in iframes) and nested `iframe.contentWindow.print()`
 * (silently dropped in Chromium/WebViews when inside cross-origin/sandboxed iframes
 * or called asynchronously inside setTimeout).
 */
export function printHtmlDirect(
  html: string,
  orientation: 'portrait' | 'landscape' = 'portrait'
): { triggered: boolean; likelyBlocked: boolean } {
  try {
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(html, 'text/html');

    // Remove any scripts or print-trigger buttons inside the parsed HTML
    parsedDoc.querySelectorAll('script, .btn-print').forEach((el) => el.remove());

    const rawStyles = Array.from(parsedDoc.querySelectorAll('style'))
      .map((s) => s.textContent || '')
      .join('\n');

    // Remove previous portal if still present
    document.getElementById('rj-print-portal')?.remove();
    document.getElementById('rj-print-portal-style')?.remove();

    const styleEl = document.createElement('style');
    styleEl.id = 'rj-print-portal-style';
    styleEl.textContent = scopePrintCss(rawStyles, orientation);
    document.head.appendChild(styleEl);

    const portal = document.createElement('div');
    portal.id = 'rj-print-portal';
    Array.from(parsedDoc.body.childNodes).forEach((node) => {
      portal.appendChild(document.importNode(node, true));
    });
    document.body.appendChild(portal);

    const wasDark = document.documentElement.classList.contains('dark');
    if (wasDark) {
      document.documentElement.classList.remove('dark');
    }
    document.body.classList.add('rj-printing-portal');

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove('rj-printing-portal');
      if (wasDark) {
        document.documentElement.classList.add('dark');
      }
      document.getElementById('rj-print-portal')?.remove();
      document.getElementById('rj-print-portal-style')?.remove();
    };

    window.addEventListener('afterprint', cleanup, { once: true });

    const startTs = performance.now();
    window.print();
    const elapsedMs = performance.now() - startTs;

    // Desktop browsers block inside window.print() until dialog closes;
    // keep portal briefly for async print preview engines, then clean up.
    setTimeout(cleanup, 1200);

    // If window.print() returned in < 25ms, the host iframe sandbox likely suppressed the dialog.
    return { triggered: true, likelyBlocked: elapsedMs < 25 };
  } catch (err) {
    console.error('[printHtmlDirect] Erro ao acionar impressão:', err);
    return { triggered: false, likelyBlocked: true };
  }
}

export function downloadHtmlFile(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.html') ? filename : `${filename}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generates and downloads a real vector A4 Portrait PDF for the
 * standard "TERMO DE NOVAÇÃO E CONFISSÃO DE DÍVIDA" (Rodolfo Jerry Imóveis).
 */
export function generateNovacaoPdf(data: NovacaoFormData): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 20;
  const maxWidth = pageWidth - marginX * 2;
  const bottomLimit = pageHeight - 20;
  let y = 22;

  const valOrBlank = (val: string, blank: string) => {
    const trimmed = (val || '').trim();
    return trimmed || blank;
  };

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > bottomLimit) {
      doc.addPage();
      y = 20;
    }
  };

  const writeHeading = (text: string, level: 1 | 2 | 3) => {
    if (level === 1) {
      doc.setFont('times', 'bold');
      doc.setFontSize(13.5);
      doc.text(text, pageWidth / 2, y, { align: 'center' });
      y += 3;
      doc.setDrawColor(17, 24, 39);
      doc.setLineWidth(0.5);
      doc.line(marginX, y, pageWidth - marginX, y);
      y += 8;
      return;
    }
    if (level === 2) {
      ensureSpace(14);
      y += 3;
      doc.setFont('times', 'bold');
      doc.setFontSize(11);
      doc.text(text, marginX, y);
      y += 6;
      return;
    }
    ensureSpace(11);
    y += 1.5;
    doc.setFont('times', 'bold');
    doc.setFontSize(10.5);
    doc.text(text, marginX, y);
    y += 5.5;
  };

  const writeParagraph = (text: string, options?: { indent?: number; boldPrefix?: string; spaceAfter?: number }) => {
    const indent = options?.indent ?? 0;
    const spaceAfter = options?.spaceAfter ?? 3.2;
    const fullText = options?.boldPrefix ? `${options.boldPrefix} ${text}` : text;
    doc.setFont('times', 'normal');
    doc.setFontSize(10.5);
    const lines = doc.splitTextToSize(fullText, maxWidth - indent) as string[];
    const lineHeight = 5.0;

    for (let i = 0; i < lines.length; i++) {
      ensureSpace(lineHeight + 2);
      const line = lines[i];
      if (i === 0 && options?.boldPrefix && line.startsWith(options.boldPrefix)) {
        const prefix = options.boldPrefix;
        const rest = line.slice(prefix.length);
        doc.setFont('times', 'bold');
        doc.text(prefix, marginX + indent, y);
        const prefixWidth = doc.getTextWidth(prefix);
        doc.setFont('times', 'normal');
        doc.text(rest, marginX + indent + prefixWidth, y);
      } else {
        doc.setFont('times', 'normal');
        doc.text(line, marginX + indent, y);
      }
      y += lineHeight;
    }
    y += spaceAfter;
  };

  // Format dynamic values with automatic Portuguese "por extenso"
  const valOrigNum = parseCurrencyString(data.valorDividaOriginal);
  const valOrigStr =
    valOrigNum > 0
      ? `R$ ${formatCurrencyNumberBR(valOrigNum)} (${valorPorExtensoBRL(valOrigNum)})`
      : `R$ ${data.valorDividaOriginal.trim() || '[VALOR DA DÍVIDA ORIGINAL]'} ([VALOR POR EXTENSO])`;

  const novoValNum = parseCurrencyString(data.novoValor);
  const novoValStr =
    novoValNum > 0
      ? `R$ ${formatCurrencyNumberBR(novoValNum)} (${valorPorExtensoBRL(novoValNum)})`
      : `R$ ${data.novoValor.trim() || '[NOVO VALOR]'} ([VALOR POR EXTENSO])`;

  const qtdNum = Math.floor(parseCurrencyString(data.quantidadeParcelas));
  const qtdStr =
    qtdNum > 0
      ? `${qtdNum} (${numeroPorExtensoPtBr(qtdNum, true)}) ${
          qtdNum === 1 ? 'parcela mensal' : 'parcelas mensais e consecutivas'
        }`
      : '[QUANTIDADE] ([QUANTIDADE POR EXTENSO]) parcelas mensais e consecutivas';

  const valParcNum = parseCurrencyString(data.valorParcela);
  const valParcStr =
    valParcNum > 0
      ? `R$ ${formatCurrencyNumberBR(valParcNum)} (${valorPorExtensoBRL(valParcNum)})`
      : `R$ ${data.valorParcela.trim() || '[VALOR DA PARCELA]'} ([VALOR POR EXTENSO])`;

  const primeiroVencStr = data.dataPrimeiroVencimento.trim()
    ? formatDateToBR(data.dataPrimeiroVencimento)
    : '[DATA DO PRIMEIRO VENCIMENTO]';

  const dataAssinaturaStr = data.dataAssinatura.trim() || '[DATA DA ASSINATURA]';

  // Logo R&J Imóveis centralizado no cabeçalho
  if (addLogoToJsPdf(doc, (pageWidth - 18) / 2, 12, 18)) {
    y = 35;
  }

  // Document content (100% faithful to the user's standard template)
  writeHeading('TERMO DE NOVAÇÃO E CONFISSÃO DE DÍVIDA', 1);

  writeHeading('1. DAS PARTES', 2);
  writeHeading('1.1. DEVEDORES:', 3);

  if (data.isCasado) {
    writeParagraph(
      `${valOrBlank(data.clienteNome, '______________________________')}, ${valOrBlank(
        data.clienteNacionalidade,
        '________________'
      )}, ${valOrBlank(
        data.clienteProfissao,
        '____________________'
      )}, portador(a) da cédula de identidade RG nº ${valOrBlank(
        data.clienteRg,
        '________________'
      )}, expedida por ${valOrBlank(
        data.clienteOrgaoExpedidor,
        '________'
      )}, inscrito(a) no CPF nº ${valOrBlank(
        data.clienteCpf,
        '__________________'
      )}, telefone ${valOrBlank(data.clienteTelefone, '________________')}, e-mail ${valOrBlank(
        data.clienteEmail,
        '________________________'
      )}, casado(a) com:`,
      { boldPrefix: 'PRIMEIRO DEVEDOR:' }
    );
    writeParagraph(
      `${valOrBlank(data.conjugeNome, '______________________________')}, ${valOrBlank(
        data.conjugeNacionalidade,
        '________________'
      )}, ${valOrBlank(
        data.conjugeProfissao,
        '____________________'
      )}, portador(a) da cédula de identidade RG nº ${valOrBlank(
        data.conjugeRg,
        '________________'
      )}, expedida por ${valOrBlank(
        data.conjugeOrgaoExpedidor,
        '________'
      )}, inscrito(a) no CPF nº ${valOrBlank(
        data.conjugeCpf,
        '__________________'
      )}, telefone ${valOrBlank(data.conjugeTelefone, '________________')}, e-mail ${valOrBlank(
        data.conjugeEmail,
        '________________________'
      )}, ambos residentes e domiciliados na ${valOrBlank(
        data.clienteResidencial,
        '__________________________________________________'
      )}.`,
      { boldPrefix: 'SEGUNDO DEVEDOR:' }
    );
  } else {
    writeParagraph(
      `${valOrBlank(data.clienteNome, '______________________________')}, ${valOrBlank(
        data.clienteNacionalidade,
        '________________'
      )}, ${valOrBlank(data.clienteEstadoCivil, '________________')}, ${valOrBlank(
        data.clienteProfissao,
        '____________________'
      )}, portador(a) da cédula de identidade RG nº ${valOrBlank(
        data.clienteRg,
        '________________'
      )}, expedida por ${valOrBlank(
        data.clienteOrgaoExpedidor,
        '________'
      )}, inscrito(a) no CPF nº ${valOrBlank(
        data.clienteCpf,
        '__________________'
      )}, telefone ${valOrBlank(data.clienteTelefone, '________________')}, e-mail ${valOrBlank(
        data.clienteEmail,
        '________________________'
      )}, residente e domiciliado(a) na ${valOrBlank(
        data.clienteResidencial,
        '__________________________________________________'
      )}.`,
      { boldPrefix: 'DEVEDOR:' }
    );
  }

  writeParagraph('Doravante denominados, individualmente, DEVEDOR e, conjuntamente, DEVEDORES.');

  writeHeading('1.2. CREDORA:', 3);
  writeParagraph(
    'pessoa jurídica de direito privado, inscrita no CNPJ sob o nº 29.881.101/0001-09 e no CRECI/SP sob o nº 39.321-J, com sede na Rua Arnóbio, nº 45, Jardim São Jorge (Raposo Tavares), São Paulo/SP, CEP 05568-040, neste ato representada na forma de seu contrato social, doravante denominada simplesmente CREDORA.',
    { boldPrefix: 'RODOLFO JERRY IMÓVEIS SOCIEDADE UNIPESSOAL LTDA,' }
  );

  writeHeading('2. DO RECONHECIMENTO DA DÍVIDA E DA NOVAÇÃO', 2);
  writeParagraph(
    `Os DEVEDORES reconhecem, de forma expressa, irrevogável e irretratável, serem devedores solidários da CREDORA da quantia nominal de ${valOrigStr}, decorrente do inadimplemento das obrigações relativas ao pagamento das comissões de intermediação imobiliária prestadas pela CREDORA, referentes à venda e compra do imóvel integrante do empreendimento ${valOrBlank(
      data.empreendimentoNome,
      '______________________________'
    )}, Unidade ${valOrBlank(data.unidadeNumero, '________')}, divisão ${valOrBlank(
      data.divisaoNome,
      '______________'
    )}, localizado na ${valOrBlank(
      data.empreendimentoEndereco,
      '______________________________________________'
    )}, objeto do Contrato de Prestação de Serviços de Intermediação Imobiliária celebrado em ${valOrBlank(
      formatDateToBR(data.vendaData),
      '___/___/_____'
    )}.`,
    { boldPrefix: '2.1.' }
  );
  writeParagraph(
    'Por meio deste instrumento, as partes, de comum acordo, resolvem novar a obrigação anteriormente constituída, nos termos dos artigos 360 e seguintes do Código Civil, mediante a substituição da obrigação originária por uma nova obrigação, com condições e forma de pagamento expressamente estabelecidas neste instrumento.',
    { boldPrefix: '2.2.' }
  );
  writeParagraph(
    `Em decorrência da presente novação, a dívida passa a ter o valor nominal total de ${novoValStr}, que será pago pelos DEVEDORES à CREDORA mediante boleto bancário, em ${qtdStr}, no valor de ${valParcStr} cada, vencendo-se a primeira em ${primeiroVencStr} e as demais no mesmo dia dos meses subsequentes, ou no último dia do respectivo mês, caso não exista dia correspondente.`,
    { boldPrefix: '2.3.' }
  );
  writeParagraph(
    'A presente novação é celebrada mediante concessões recíprocas quanto às condições de pagamento, não importando em renúncia da CREDORA ao recebimento integral da obrigação novada, nos termos e condições ora estabelecidos.',
    { boldPrefix: '2.4.' }
  );

  writeHeading('3. DO INADIMPLEMENTO E DO VENCIMENTO ANTECIPADO', 2);
  writeParagraph(
    'O não pagamento de qualquer parcela na respectiva data de vencimento acarretará, independentemente de aviso ou notificação judicial ou extrajudicial, o vencimento antecipado das demais parcelas vincendas, tornando imediatamente exigível a totalidade do saldo devedor remanescente da obrigação novada.',
    { boldPrefix: '3.1.' }
  );
  writeParagraph('Sobre o saldo devedor em aberto incidirão:', { boldPrefix: '3.2.', spaceAfter: 2 });
  writeParagraph(
    'a) Correção monetária pelo Índice Geral de Preços – Mercado (IGP-M), divulgado pela Fundação Getulio Vargas (FGV), calculada desde o vencimento da parcela inadimplida até o efetivo pagamento, observada a aplicação do índice substituto que legalmente venha a sucedê-lo ou, na sua ausência, do IPCA/IBGE;',
    { indent: 6, spaceAfter: 2 }
  );
  writeParagraph(
    'b) Juros moratórios de 1% (um por cento) ao mês, calculados proporcionalmente aos dias de atraso;',
    { indent: 6, spaceAfter: 2 }
  );
  writeParagraph(
    'c) Multa moratória de 2% (dois por cento) sobre o valor da obrigação inadimplida, devidamente atualizado.',
    { indent: 6 }
  );
  writeParagraph(
    'Todos os pagamentos realizados pelos DEVEDORES serão obrigatoriamente considerados para abatimento do saldo devedor, vedada qualquer cobrança em duplicidade.',
    { boldPrefix: '3.3.' }
  );
  writeParagraph(
    'O vencimento antecipado não implicará o restabelecimento da obrigação originária, uma vez que esta foi substituída pela presente novação, permanecendo exigível o saldo da nova obrigação, acrescido dos encargos previstos neste instrumento.',
    { boldPrefix: '3.4.' }
  );
  writeParagraph(
    'O inadimplemento autoriza a CREDORA a promover a cobrança extrajudicial ou judicial do saldo devedor, inclusive mediante protesto deste instrumento e inscrição dos DEVEDORES nos órgãos de proteção ao crédito, observados os requisitos legais aplicáveis.',
    { boldPrefix: '3.5.' }
  );

  writeHeading('4. DOS HONORÁRIOS ADVOCATÍCIOS E DESPESAS DE COBRANÇA', 2);
  writeParagraph(
    'Em caso de inadimplemento e necessidade de adoção de medidas de cobrança extrajudicial ou judicial, os DEVEDORES responderão pelo pagamento de honorários advocatícios contratuais no percentual de 20% (vinte por cento) sobre o valor atualizado do débito, além das despesas comprovadamente incorridas pela CREDORA para recuperação do crédito, observada a legislação aplicável.',
    { boldPrefix: '4.1.' }
  );
  writeParagraph(
    'Na hipótese de cobrança judicial, serão devidas, ainda, as custas processuais e demais despesas judiciais, bem como os honorários sucumbenciais que vierem a ser fixados judicialmente, observada a vedação de duplicidade de cobrança da mesma verba honorária.',
    { boldPrefix: '4.2.' }
  );

  writeHeading('5. DA EXIGIBILIDADE E DO TÍTULO EXECUTIVO EXTRAJUDICIAL', 2);
  writeParagraph(
    'Os DEVEDORES reconhecem expressamente a origem, a legitimidade e a exigibilidade da obrigação ora novada, declarando que celebram o presente instrumento de forma livre e consciente, após ciência integral de suas condições.',
    { boldPrefix: '5.1.' }
  );
  writeParagraph(
    'O presente instrumento, quando assinado pelos DEVEDORES e observado o disposto no artigo 784, III e § 4º, do Código de Processo Civil, constitui título executivo extrajudicial, desde que preenchidos os respectivos requisitos legais, podendo ser utilizado pela CREDORA para cobrança judicial da obrigação nele estabelecida.',
    { boldPrefix: '5.2.' }
  );
  writeParagraph(
    'Os DEVEDORES declaram estar cientes de que o inadimplemento poderá ensejar o protesto do presente instrumento e a adoção das medidas legais cabíveis para recuperação do crédito, respeitadas as exigências legais específicas de cada procedimento.',
    { boldPrefix: '5.3.' }
  );

  writeHeading('6. DA RESPONSABILIDADE SOLIDÁRIA', 2);
  writeParagraph(
    'Os DEVEDORES assumem expressamente, em caráter solidário, a responsabilidade pelo cumprimento integral de todas as obrigações decorrentes deste instrumento, nos termos dos artigos 264 e seguintes do Código Civil.',
    { boldPrefix: '6.1.' }
  );
  writeParagraph(
    'A CREDORA poderá exigir de qualquer um dos DEVEDORES, isolada ou conjuntamente, o pagamento integral da dívida, independentemente de prévia cobrança do outro DEVEDOR, sem prejuízo do direito de regresso entre os coobrigados.',
    { boldPrefix: '6.2.' }
  );
  writeParagraph(
    'Os DEVEDORES declaram ter plena ciência de que a solidariedade ora assumida permite à CREDORA exigir de qualquer deles a integralidade do saldo devedor, incluindo principal, encargos moratórios, despesas de cobrança e demais obrigações previstas neste instrumento.',
    { boldPrefix: '6.3.' }
  );

  writeHeading('7. DAS DISPOSIÇÕES GERAIS', 2);
  writeParagraph(
    'O presente instrumento é celebrado em caráter irrevogável e irretratável, obrigando as partes, seus herdeiros e sucessores, a qualquer título, ao fiel cumprimento de todas as suas disposições.',
    { boldPrefix: '7.1.' }
  );
  writeParagraph(
    'Qualquer tolerância da CREDORA quanto ao atraso ou descumprimento de obrigação prevista neste instrumento não constituirá novação adicional, renúncia de direito ou alteração contratual.',
    { boldPrefix: '7.2.' }
  );
  writeParagraph(
    'Qualquer alteração das condições aqui pactuadas somente terá validade mediante instrumento escrito firmado pelas partes.',
    { boldPrefix: '7.3.' }
  );
  writeParagraph(
    'As partes reconhecem a validade das assinaturas eletrônicas apostas neste instrumento, inclusive por meio de plataformas de assinatura eletrônica que permitam a identificação dos signatários e a verificação da integridade do documento, nos termos da legislação aplicável, especialmente do artigo 784, § 4º, do Código de Processo Civil.',
    { boldPrefix: '7.4.' }
  );

  writeHeading('8. DO FORO', 2);
  writeParagraph(
    'As partes elegem o Foro da Comarca da Capital do Estado de São Paulo para dirimir quaisquer controvérsias decorrentes deste instrumento, ressalvadas as hipóteses de competência absoluta e as regras legais de proteção ao foro do consumidor, quando aplicáveis.',
    { boldPrefix: '8.1.' }
  );

  y += 3;
  writeParagraph(
    'E, por estarem justas e contratadas, as partes firmam o presente instrumento, juntamente com as testemunhas abaixo identificadas, para que produza todos os seus efeitos jurídicos e legais.'
  );
  writeParagraph(`São Paulo/SP, ${dataAssinaturaStr}.`, { spaceAfter: 6 });

  ensureSpace(22);
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 8;

  const drawSignatureBlock = (role: string, lines: string[]) => {
    ensureSpace(28);
    doc.setFont('times', 'bold');
    doc.setFontSize(10.5);
    doc.text(role, marginX, y);
    y += 5;
    doc.setFont('times', 'normal');
    lines.forEach((ln) => {
      doc.text(ln, marginX, y);
      y += 5;
    });
    y += 3;
    doc.text('Assinatura: ____________________________________________', marginX, y);
    y += 10;
  };

  if (data.isCasado) {
    drawSignatureBlock('PRIMEIRO DEVEDOR:', [
      valOrBlank(data.clienteNome, '__________________________________________________'),
      `CPF: ${valOrBlank(data.clienteCpf, '______________________________')}`,
    ]);
    drawSignatureBlock('SEGUNDO DEVEDOR:', [
      valOrBlank(data.conjugeNome, '__________________________________________________'),
      `CPF: ${valOrBlank(data.conjugeCpf, '______________________________')}`,
    ]);
  } else {
    drawSignatureBlock('DEVEDOR:', [
      valOrBlank(data.clienteNome, '__________________________________________________'),
      `CPF: ${valOrBlank(data.clienteCpf, '______________________________')}`,
    ]);
  }

  drawSignatureBlock('CREDORA:', [
    'RODOLFO JERRY IMÓVEIS SOCIEDADE UNIPESSOAL LTDA',
    `Representante: ${valOrBlank(data.credoraRepresentante, '______________________________________')}`,
  ]);

  ensureSpace(34);
  doc.setFont('times', 'bold');
  doc.setFontSize(10.5);
  doc.text('TESTEMUNHAS:', marginX, y);
  y += 6;
  doc.setFont('times', 'normal');
  const col2X = marginX + maxWidth / 2 + 4;
  doc.text('1.', marginX, y);
  doc.text('2.', col2X, y);
  y += 5;
  doc.text('Nome: ______________________________', marginX, y);
  doc.text('Nome: ______________________________', col2X, y);
  y += 5;
  doc.text('CPF: _______________________________', marginX, y);
  doc.text('CPF: _______________________________', col2X, y);
  y += 7;
  doc.text('Assinatura: ________________________', marginX, y);
  doc.text('Assinatura: ________________________', col2X, y);

  const safeClient = (data.clienteNome || 'padrao')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  doc.save(`termo_novacao_${safeClient || 'padrao'}.pdf`);
}

/**
 * Generates and downloads a real vector A4 Portrait PDF for the
 * "INSTRUMENTO PARTICULAR DE CONFISSÃO DE DÍVIDA E PARCELAMENTO"
 * preserving the visual identity of the Contrato de Corretagem (Helvetica, #0f172a, #f1f5f9 section headers, .info-card boxes, .sig-box lines).
 */
export function generateConfissaoDividaPdf(data: NovacaoFormData): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 18;
  const maxWidth = pageWidth - marginX * 2;
  const bottomLimit = pageHeight - 16;
  let y = 16;

  const valOrBlank = (val: string, blank: string) => {
    const trimmed = (val || '').trim();
    return trimmed || blank;
  };

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > bottomLimit) {
      doc.addPage();
      y = 16;
    }
  };

  const writeSectionHeader = (title: string) => {
    ensureSpace(12);
    y += 2;
    // Slate background bar (#f1f5f9) + dark left accent border (#0f172a) matching Contrato de Corretagem
    doc.setFillColor(241, 245, 249);
    doc.rect(marginX, y - 4, maxWidth, 6.2, 'F');
    doc.setFillColor(15, 23, 42);
    doc.rect(marginX, y - 4, 1.1, 6.2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(title, marginX + 3.2, y + 0.3);
    y += 5.2;
  };

  const writeInfoCard = (cardTitle: string, bodyText: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const lines = doc.splitTextToSize(bodyText, maxWidth - 6) as string[];
    const lineHeight = 4.0;
    const cardHeight = 6.5 + lines.length * lineHeight + 2.2;
    ensureSpace(cardHeight + 2);

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.roundedRect(marginX, y, maxWidth, cardHeight, 1.2, 1.2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(cardTitle, marginX + 3, y + 4.4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.4);
    doc.setTextColor(51, 65, 85);
    let innerY = y + 8.6;
    for (const line of lines) {
      doc.text(line, marginX + 3, innerY);
      innerY += lineHeight;
    }

    y += cardHeight + 2.4;
  };

  const writeClause = (
    text: string,
    options?: { boldPrefix?: string; indent?: number; spaceAfter?: number }
  ) => {
    const indent = options?.indent ?? 0;
    const spaceAfter = options?.spaceAfter ?? 2.4;
    const fullText = options?.boldPrefix ? `${options.boldPrefix} ${text}` : text;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.8);
    doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(fullText, maxWidth - indent) as string[];
    const lineHeight = 4.1;

    for (let i = 0; i < lines.length; i++) {
      ensureSpace(lineHeight + 1.5);
      const line = lines[i];
      if (i === 0 && options?.boldPrefix && line.startsWith(options.boldPrefix)) {
        const prefix = options.boldPrefix;
        const rest = line.slice(prefix.length);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(prefix, marginX + indent, y);
        const prefixWidth = doc.getTextWidth(prefix);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 41, 59);
        doc.text(rest, marginX + indent + prefixWidth, y);
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 41, 59);
        doc.text(line, marginX + indent, y);
      }
      y += lineHeight;
    }
    y += spaceAfter;
  };

  // Dynamic values with automatic Portuguese "por extenso"
  const valTotalRaw = data.valorDividaOriginal.trim() || data.novoValor.trim();
  const valTotalNum = parseCurrencyString(valTotalRaw);
  const valTotalStr =
    valTotalNum > 0
      ? `R$ ${formatCurrencyNumberBR(valTotalNum)} (${valorPorExtensoBRL(valTotalNum)})`
      : `R$ ${valTotalRaw || '[VALOR_TOTAL_DIVIDA]'} ([VALOR_TOTAL_DIVIDA_EXTENSO])`;

  const dataVencOriginalStr = data.dataVencimentoOriginal.trim()
    ? formatDateToBR(data.dataVencimentoOriginal)
    : '[DATA_VENCIMENTO_ORIGINAL]';

  const valEntradaNum = parseCurrencyString(data.valorEntrada);
  const valEntradaStr =
    valEntradaNum > 0
      ? `R$ ${formatCurrencyNumberBR(valEntradaNum)} (${valorPorExtensoBRL(valEntradaNum)})`
      : `R$ ${data.valorEntrada.trim() || '[VALOR_ENTRADA]'} ([VALOR_ENTRADA_EXTENSO])`;

  const dataVenc1Str = data.dataVencimento1.trim()
    ? formatDateToBR(data.dataVencimento1)
    : '[DATA_VENCIMENTO_1]';

  const qtdRestNum = Math.floor(parseCurrencyString(data.qtdParcelasRestantes));
  const qtdRestStr =
    qtdRestNum > 0
      ? `${qtdRestNum} (${numeroPorExtensoPtBr(qtdRestNum, true)})`
      : '[QTD_PARCELAS_RESTANTES] ([QTD_PARCELAS_RESTANTES_EXTENSO])';

  const valParcRestNum = parseCurrencyString(data.valorParcelaRestante);
  const valParcRestStr =
    valParcRestNum > 0
      ? `R$ ${formatCurrencyNumberBR(valParcRestNum)} (${valorPorExtensoBRL(valParcRestNum)})`
      : `R$ ${data.valorParcelaRestante.trim() || '[VALOR_PARCELA]'} ([VALOR_PARCELA_EXTENSO])`;

  const dataVenc2Str = data.dataVencimento2.trim()
    ? formatDateToBR(data.dataVencimento2)
    : '[DATA_VENCIMENTO_2]';

  const dataAssinaturaStr = data.dataAssinatura.trim() || '[DATA_ASSINATURA]';

  // CABEÇALHO NO PADRÃO DO CONTRATO DE CORRETAGEM COM LOGO R&J
  if (addLogoToJsPdf(doc, (pageWidth - 18) / 2, 11, 18)) {
    y = 33.5;
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.5);
    doc.setTextColor(15, 23, 42);
    doc.text('R&J', pageWidth / 2, y, { align: 'center' });
    y += 3.6;
    doc.setFontSize(7.2);
    doc.setTextColor(2, 132, 199);
    doc.text('IMÓVEIS', pageWidth / 2, y, { align: 'center' });
    y += 5.8;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.8);
  doc.setTextColor(15, 23, 42);
  doc.text('INSTRUMENTO PARTICULAR DE CONFISSÃO DE DÍVIDA E PARCELAMENTO', pageWidth / 2, y, {
    align: 'center',
  });
  y += 4.5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(100, 116, 139);
  doc.text('RODOLFO JERRY IMÓVEIS SOCIEDADE UNIPESSOAL LTDA. • CRECI/SP 39321-J', pageWidth / 2, y, {
    align: 'center',
  });
  y += 3.2;

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.6);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 5;

  // 1. DAS PARTES
  writeSectionHeader('1. DAS PARTES');

  const devedorCardBody = data.isCasado
    ? `${valOrBlank(data.clienteNome, '______________________________')}, ${valOrBlank(
        data.clienteNacionalidade,
        '________________'
      )}, ${valOrBlank(
        data.clienteProfissao,
        '____________________'
      )}, portador(a) da cédula de identidade RG n.º ${valOrBlank(
        data.clienteRg,
        '________________'
      )} ${valOrBlank(
        data.clienteOrgaoExpedidor,
        '________'
      )}, inscrito(a) no CPF/MF sob o n.º ${valOrBlank(
        data.clienteCpf,
        '__________________'
      )}, telefone ${valOrBlank(data.clienteTelefone, '________________')}, e-mail ${valOrBlank(
        data.clienteEmail,
        '________________________'
      )}, casado(a) com ${valOrBlank(
        data.conjugeNome,
        '______________________________'
      )}, ${valOrBlank(data.conjugeNacionalidade, '________________')}, ${valOrBlank(
        data.conjugeProfissao,
        '____________________'
      )}, portador(a) da cédula de identidade RG n.º ${valOrBlank(
        data.conjugeRg,
        '________________'
      )} ${valOrBlank(
        data.conjugeOrgaoExpedidor,
        '________'
      )}, inscrito(a) no CPF/MF sob o n.º ${valOrBlank(
        data.conjugeCpf,
        '__________________'
      )}, telefone ${valOrBlank(data.conjugeTelefone, '________________')}, e-mail ${valOrBlank(
        data.conjugeEmail,
        '________________________'
      )}, residentes e domiciliados na ${valOrBlank(
        data.clienteResidencial,
        '__________________________________________________'
      )}, doravante denominado(s) simplesmente DEVEDOR(ES), independentemente de gênero e número.`
    : `${valOrBlank(data.clienteNome, '______________________________')}, ${valOrBlank(
        data.clienteNacionalidade,
        '________________'
      )}, ${valOrBlank(data.clienteEstadoCivil, '________________')}, ${valOrBlank(
        data.clienteProfissao,
        '____________________'
      )}, portador(a) da cédula de identidade RG n.º ${valOrBlank(
        data.clienteRg,
        '________________'
      )} ${valOrBlank(
        data.clienteOrgaoExpedidor,
        '________'
      )}, inscrito(a) no CPF/MF sob o n.º ${valOrBlank(
        data.clienteCpf,
        '__________________'
      )}, telefone ${valOrBlank(data.clienteTelefone, '________________')}, e-mail ${valOrBlank(
        data.clienteEmail,
        '________________________'
      )}, residente e domiciliado(a) na ${valOrBlank(
        data.clienteResidencial,
        '__________________________________________________'
      )}, doravante denominado(s) simplesmente DEVEDOR(ES), independentemente de gênero e número.`;

  writeInfoCard('1.1. DEVEDOR(ES):', devedorCardBody);
  writeInfoCard(
    '1.2. CREDORA:',
    'RODOLFO JERRY IMÓVEIS SOCIEDADE UNIPESSOAL LTDA., pessoa jurídica de direito privado, inscrita no CNPJ/MF sob o n.º 29.881.101/0001-09 e no CRECI/SP sob o n.º 39321-J, com sede na Rua Arnóbio, n.º 45, Jardim São Jorge (Raposo Tavares), São Paulo/SP, CEP 05568-040, neste ato representada na forma de seu contrato social, doravante denominada simplesmente CREDORA.'
  );

  y += 1;
  writeClause(
    'As partes acima qualificadas têm entre si justo e acertado o presente Instrumento Particular de Confissão de Dívida e Parcelamento, que se regerá pelas cláusulas e condições a seguir:'
  );

  // 2. DA CONFISSÃO DE DÍVIDA E DO PARCELAMENTO
  writeSectionHeader('2. DA CONFISSÃO DE DÍVIDA E DO PARCELAMENTO');
  writeClause(
    `O(s) DEVEDOR(ES) reconhece(m) e confessa(m), de forma livre, irretratável e irrevogável, dever à CREDORA a quantia líquida, certa e exigível de ${valTotalStr}, vencida originalmente em ${dataVencOriginalStr}, decorrente do inadimplemento das parcelas de honorários de intermediação imobiliária prestada pela CREDORA referente à aquisição da Unidade ${valOrBlank(
      data.unidadeNumero,
      '________'
    )}, ${valOrBlank(data.divisaoNome, '______________')}, do empreendimento ${valOrBlank(
      data.empreendimentoNome,
      '______________________________'
    )}, localizado na ${valOrBlank(
      data.empreendimentoEndereco,
      '______________________________________________'
    )}, objeto do “Contrato de Prestação de Serviços de Intermediação Imobiliária” firmado em ${valOrBlank(
      formatDateToBR(data.vendaData),
      '___/___/_____'
    )}.`,
    { boldPrefix: '2.1.' }
  );
  writeClause(
    'Por mera liberalidade da CREDORA e para facilitar a liquidação do débito ora confessado, o valor total indicado na cláusula 2.1 será pago pelo(s) DEVEDOR(ES), mediante boleto bancário emitido pela CREDORA ou transferência via PIX para a chave CNPJ 29.881.101/0001-09, da seguinte forma:',
    { boldPrefix: '2.2.', spaceAfter: 1.5 }
  );
  writeClause(
    `no valor de ${valEntradaStr}, com vencimento em ${dataVenc1Str};`,
    { boldPrefix: 'a) Sinal / 1ª Parcela:', indent: 5, spaceAfter: 1.5 }
  );
  writeClause(
    `em ${qtdRestStr} parcelas mensais, iguais e consecutivas no valor de ${valParcRestStr} cada, vencendo-se a primeira delas em ${dataVenc2Str} e as demais no mesmo dia dos meses subsequentes.`,
    { boldPrefix: 'b) Saldo Remanescente:', indent: 5, spaceAfter: 2.4 }
  );
  writeClause(
    'Fica expressamente ajustado entre as partes que o presente acordo possui natureza meramente moratória e dilatória de prazo, NÃO CONSTITUINDO NOVAÇÃO (art. 361 do Código Civil), permanecendo íntegras a obrigação originária e todas as suas garantias.',
    { boldPrefix: '2.3.' }
  );

  // 3. DO INADIMPLEMENTO E DAS PENALIDADES
  writeSectionHeader('3. DO INADIMPLEMENTO E DAS PENALIDADES');
  writeClause(
    'O atraso ou não pagamento de qualquer parcela na data de seu respectivo vencimento, independentemente de aviso, notificação ou interpelação judicial ou extrajudicial, implicará:',
    { boldPrefix: '3.1.', spaceAfter: 1.5 }
  );
  writeClause('O vencimento antecipado automático da totalidade do saldo devedor remanescente;', {
    boldPrefix: 'a)',
    indent: 5,
    spaceAfter: 1.5,
  });
  writeClause(
    'A perda imediata de quaisquer descontos, isenções de encargos ou abatimentos eventualmente concedidos neste acordo, restabelecendo-se o valor integral da dívida originária, abatidas apenas as quantias efetivamente pagas até a data da mora;',
    { boldPrefix: 'b)', indent: 5, spaceAfter: 1.5 }
  );
  writeClause(
    `A incidência, sobre o saldo devedor atualizado desde o vencimento original (${dataVencOriginalStr}), de correção monetária positiva pelo IGP-M/FGV (ou índice oficial substituto), juros moratórios de 1% (um por cento) ao mês pro rata die, multa moratória irredutível de 2% (dois por cento) sobre o montante corrigido e honorários advocatícios de 20% (vinte por cento) em caso de cobrança extrajudicial ou judicial, além de custas processuais e emolumentos de cartório.`,
    { boldPrefix: 'c)', indent: 5, spaceAfter: 2.4 }
  );

  // 4. DA EXECUÇÃO E DISPOSIÇÕES GERAIS
  writeSectionHeader('4. DA EXECUÇÃO E DISPOSIÇÕES GERAIS');
  writeClause(
    'O(s) DEVEDOR(ES) reconhece(m) que este instrumento constitui Título Executivo Extrajudicial, nos termos do art. 784, inciso III (e § 4º, quando assinado eletronicamente), do Código de Processo Civil, autorizando a CREDORA, em caso de inadimplemento, a promover o protesto do título em cartório (CENPROT) e a inclusão do(s) nome(s) do(s) DEVEDOR(ES) nos cadastros de proteção ao crédito (SPC, Serasa, Boa Vista e congêneres), observadas as comunicações legais cabíveis.',
    { boldPrefix: '4.1.' }
  );
  writeClause(
    'O(s) DEVEDOR(ES) renuncia(m) expressamente a qualquer alegação futura de desconhecimento, vício de consentimento ou nulidade quanto à origem, liquidez, certeza e exigibilidade da dívida ora confessada.',
    { boldPrefix: '4.2.' }
  );
  writeClause(
    'Havendo mais de um devedor, todos respondem solidariamente pelo cumprimento integral das obrigações assumidas neste instrumento, nos termos dos artigos 264 e 275 do Código Civil, renunciando expressamente ao benefício de ordem previsto no art. 827 do Código Civil.',
    { boldPrefix: '4.3.' }
  );
  writeClause(
    'A eventual tolerância da CREDORA quanto ao atraso no pagamento de qualquer parcela não implicará novação, renúncia de direitos ou alteração das condições pactuadas.',
    { boldPrefix: '4.4.' }
  );
  writeClause(
    'Este instrumento obriga as partes, seus herdeiros e sucessores a qualquer título, elegendo-se o Foro da Comarca da Capital do Estado de São Paulo/SP para dirimir quaisquer questões dele oriundas, com renúncia expressa a qualquer outro, por mais privilegiado que seja.',
    { boldPrefix: '4.5.' }
  );

  y += 1;
  writeClause(
    'E, por estarem assim justas e contratadas, assinam o presente instrumento em meio físico ou eletrônico, nos termos da Medida Provisória n.º 2.200-2/2001, da Lei n.º 14.063/2020 e do art. 784, § 4º, do Código de Processo Civil, juntamente com 2 (duas) testemunhas, quando aplicável.'
  );

  // ASSINATURAS NO PADRÃO DO CONTRATO DE CORRETAGEM
  ensureSpace(68);
  writeSectionHeader('ASSINATURAS');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.setTextColor(15, 23, 42);
  doc.text(`São Paulo/SP, ${dataAssinaturaStr}.`, pageWidth / 2, y + 2, { align: 'center' });
  y += 9;

  const drawCenteredSigLine = (label: string, name: string, subtitle: string) => {
    ensureSpace(22);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.setTextColor(71, 85, 105);
    doc.text(label, marginX, y);
    y += 10;
    const lineW = 104;
    const x1 = (pageWidth - lineW) / 2;
    doc.setDrawColor(51, 65, 85);
    doc.setLineWidth(0.3);
    doc.line(x1, y, x1 + lineW, y);
    y += 3.8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(15, 23, 42);
    doc.text(name.toUpperCase(), pageWidth / 2, y, { align: 'center' });
    y += 3.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    doc.setTextColor(100, 116, 139);
    doc.text(subtitle, pageWidth / 2, y, { align: 'center' });
    y += 7;
  };

  if (data.isCasado) {
    ensureSpace(24);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.setTextColor(71, 85, 105);
    doc.text('DEVEDOR(ES):', marginX, y);
    y += 10;
    const colW = (maxWidth - 10) / 2;
    const col2X = marginX + colW + 10;
    doc.setDrawColor(51, 65, 85);
    doc.setLineWidth(0.3);
    doc.line(marginX, y, marginX + colW, y);
    doc.line(col2X, y, col2X + colW, y);
    y += 3.8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.0);
    doc.setTextColor(15, 23, 42);
    doc.text(
      valOrBlank(data.clienteNome, '______________________________').toUpperCase(),
      marginX + colW / 2,
      y,
      { align: 'center' }
    );
    doc.text(
      valOrBlank(data.conjugeNome, '______________________________').toUpperCase(),
      col2X + colW / 2,
      y,
      { align: 'center' }
    );
    y += 3.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`CPF: ${valOrBlank(data.clienteCpf, '____________________')}`, marginX + colW / 2, y, {
      align: 'center',
    });
    doc.text(`CPF: ${valOrBlank(data.conjugeCpf, '____________________')}`, col2X + colW / 2, y, {
      align: 'center',
    });
    y += 7;
  } else {
    drawCenteredSigLine(
      'DEVEDOR(ES):',
      valOrBlank(data.clienteNome, '____________________________________'),
      `CPF: ${valOrBlank(data.clienteCpf, '____________________')}`
    );
  }

  drawCenteredSigLine(
    'CREDORA:',
    'RODOLFO JERRY IMÓVEIS SOCIEDADE UNIPESSOAL LTDA.',
    'CNPJ: 29.881.101/0001-09'
  );

  // Testemunhas
  ensureSpace(26);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.6);
  doc.setTextColor(71, 85, 105);
  doc.text('TESTEMUNHAS:', marginX, y);
  y += 10;

  const wColW = (maxWidth - 10) / 2;
  const wCol2X = marginX + wColW + 10;
  doc.setDrawColor(51, 65, 85);
  doc.setLineWidth(0.3);
  doc.line(marginX, y, marginX + wColW, y);
  doc.line(wCol2X, y, wCol2X + wColW, y);
  y += 3.8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.0);
  doc.setTextColor(15, 23, 42);
  doc.text('1. TESTEMUNHA', marginX + wColW / 2, y, { align: 'center' });
  doc.text('2. TESTEMUNHA', wCol2X + wColW / 2, y, { align: 'center' });
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  doc.setTextColor(51, 65, 85);
  doc.text('Nome: __________________________________', marginX, y);
  doc.text('Nome: __________________________________', wCol2X, y);
  y += 4;
  doc.text('CPF: ___________________________________', marginX, y);
  doc.text('CPF: ___________________________________', wCol2X, y);

  const safeClient = (data.clienteNome || 'padrao')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  doc.save(`confissao_divida_${safeClient || 'padrao'}.pdf`);
}

export interface RateioPdfParams {
  mode: 'rateio' | 'laudo';
  title: string;
  subtitle?: string;
  reference?: string;
  modalidade?: string;
  percentualGlobal: number;
  waterfall: WaterfallResult;
  visibleRows: Array<{
    vencimento: string;
    tipo: string;
    valorParcela: number;
    distribuicao: Record<string, number>;
  }>;
  credentials: Array<{
    nome: string;
    apelido: string;
    cpf: string;
    creci: string;
    cargo: string;
  }>;
  diagnostico?: DiagnosticoEspecialista | null;
  observacao?: string;
  filenamePrefix?: string;
}

const fmtBRL = (val: number) =>
  (Number(val) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtPct = (val: number) =>
  `${(Number(val) || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;

/**
 * Generates and downloads a real vector A4 Landscape PDF for Rateio Geral or Laudo Técnico (4 Seções).
 */
export function generateRateioPdf(params: RateioPdfParams): void {
  const {
    mode,
    title,
    subtitle,
    reference,
    modalidade,
    percentualGlobal,
    waterfall,
    visibleRows,
    credentials,
    diagnostico,
    observacao,
    filenamePrefix = 'rateio',
  } = params;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 12;
  const isLiquidado = waterfall.saldoRestanteComissao <= 0.01 && waterfall.comissaoTotal > 0;
  const totalParcelas = visibleRows.reduce((s, r) => s + r.valorParcela, 0);
  const totalDistribuido = Math.max(0, waterfall.comissaoTotal - waterfall.saldoRestanteComissao);

  // Header com Logo R&J Imóveis
  const hasRateioLogo = addLogoToJsPdf(doc, marginX, 7.5, 14);
  const titleX = hasRateioLogo ? marginX + 17 : marginX;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(
    mode === 'laudo' ? `LAUDO TÉCNICO DE AUDITORIA — ${title}` : `TABELA DE RATEIO GERAL — ${title}`,
    titleX,
    14
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  if (subtitle) {
    doc.text(subtitle, titleX, 19);
  }
  doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - marginX, 14, {
    align: 'right',
  });

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.5);
  doc.line(marginX, 23, pageWidth - marginX, 23);

  // Summary Info Bar
  autoTable(doc, {
    startY: 25.5,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    styles: {
      fontSize: 7.5,
      cellPadding: 2.2,
      textColor: [15, 23, 42],
      lineColor: [15, 23, 42],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [71, 85, 105],
      fontStyle: 'bold',
      fontSize: 6.5,
    },
    head: [
      [
        'REFERÊNCIA / IMÓVEL',
        'MODALIDADE',
        'VALOR BASE / VGV',
        'RATEIO GLOBAL',
        'PARCELAS NO FLUXO',
        'STATUS',
      ],
    ],
    body: [
      [
        reference || 'Não informada',
        modalidade || 'Pagadoria',
        fmtBRL(waterfall.vendaTotal),
        `${fmtPct(percentualGlobal)} (${fmtBRL(waterfall.comissaoTotal)})`,
        `${visibleRows.length} parcela(s)`,
        isLiquidado ? '100% LIQUIDADO' : 'EM ABERTO',
      ],
    ],
  });

  let y = ((doc as any).lastAutoTable?.finalY || 38) + 6;

  const participantHeaders = waterfall.participantes.map((p) =>
    p.name ? `${p.role}\n${p.name.split(' ')[0]}` : p.role
  );
  const matrixHead = ['#', 'Vencimento', 'Tipo', 'Parcela', ...participantHeaders];
  const matrixBody = visibleRows.map((row, idx) => [
    String(idx + 1).padStart(2, '0'),
    row.vencimento,
    row.tipo || 'Parcela',
    fmtBRL(row.valorParcela),
    ...waterfall.participantes.map((p) => {
      const lbl = p.name ? `${p.role} - ${p.name}` : p.role;
      const v = row.distribuicao[lbl] || 0;
      return v > 0 ? fmtBRL(v) : '-';
    }),
  ]);
  const matrixFoot = [
    '',
    'TOTAL',
    isLiquidado ? '100% LIQUIDADO' : 'PARCIAL',
    fmtBRL(totalParcelas),
    ...waterfall.participantes.map((p) => fmtBRL(p.received)),
  ];

  const colCount = matrixHead.length;
  const matrixFontSize = colCount > 10 ? 6.2 : colCount > 7 ? 7 : 7.8;

  if (mode === 'laudo' && diagnostico) {
    // Seção I
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text('SEÇÃO I — MEMÓRIA DE CÁLCULO E PARÂMETROS DE ENTRADA', marginX, y);
    autoTable(doc, {
      startY: y + 2,
      margin: { left: marginX, right: marginX },
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 2, lineColor: [15, 23, 42], lineWidth: 0.2 },
      headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
      head: [['Participante', 'Alíquota', 'Teto Nominal', 'Regra / Exceção', 'Hierarquia']],
      body: diagnostico.secaoI.participantes.map((p) => [
        p.label,
        fmtPct(p.aliquotaVGV + (p.taxaPremio || 0)),
        fmtBRL(p.tetoNominal),
        p.excecao,
        p.tierLabel,
      ]),
    });

    y = ((doc as any).lastAutoTable?.finalY || y + 20) + 6;
    if (y > 165) {
      doc.addPage();
      y = 16;
    }

    // Seção II
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('SEÇÃO II — AMORTIZAÇÃO DO FLUXO DE RECEBÍVEIS', marginX, y);
    autoTable(doc, {
      startY: y + 2,
      margin: { left: marginX, right: marginX },
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 2, lineColor: [15, 23, 42], lineWidth: 0.2 },
      headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
      head: [['#', 'Vencimento', 'Tipo', 'Parcela Bruta', 'Dedução Aplicada', 'Saldo Residual']],
      body: diagnostico.secaoII.map((row) => [
        String(row.linha),
        row.vencimento,
        row.tipo,
        fmtBRL(row.parcelaBruta),
        fmtBRL(row.deducaoAplicada),
        fmtBRL(row.saldoDevedorComissao),
      ]),
    });

    y = ((doc as any).lastAutoTable?.finalY || y + 20) + 6;
    if (y > 165) {
      doc.addPage();
      y = 16;
    }

    // Seção III
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('SEÇÃO III — MATRIZ DEFINITIVA DE REPASSE (VENCIMENTO A VENCIMENTO)', marginX, y);
    autoTable(doc, {
      startY: y + 2,
      margin: { left: marginX, right: marginX },
      theme: 'grid',
      styles: {
        fontSize: matrixFontSize,
        cellPadding: 1.8,
        lineColor: [15, 23, 42],
        lineWidth: 0.2,
      },
      headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
      head: [matrixHead],
      body: matrixBody,
      foot: [matrixFoot],
    });

    y = ((doc as any).lastAutoTable?.finalY || y + 20) + 6;
    if (y > 165) {
      doc.addPage();
      y = 16;
    }

    // Seção IV
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('SEÇÃO IV — DIAGNÓSTICO DE EVENTOS CRÍTICOS (INFLEXÕES & QUITAÇÃO)', marginX, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    if (diagnostico.secaoIV.inflexoes.length === 0) {
      doc.text('• Sem inflexões de quitação antecipada registradas.', marginX, y);
      y += 5;
    } else {
      diagnostico.secaoIV.inflexoes.forEach((inf) => {
        if (y > 192) {
          doc.addPage();
          y = 16;
        }
        doc.text(
          `• ${inf.participante}: quitado em ${inf.parcelaQuitacao} (${inf.vencimento}) — Teto atingido: ${fmtBRL(
            inf.tetoAtingido
          )}`,
          marginX,
          y
        );
        y += 4.5;
      });
    }
    if (diagnostico.secaoIV.liberacaoFluxoIntegral) {
      y += 2;
      doc.setFont('helvetica', 'bold');
      doc.text(
        `Quitação Integral: ${diagnostico.secaoIV.liberacaoFluxoIntegral.parcela} em ${diagnostico.secaoIV.liberacaoFluxoIntegral.vencimento}.`,
        marginX,
        y
      );
    }
  } else {
    // Rateio Geral Matrix
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text('CRONOGRAMA VENCIMENTO A VENCIMENTO', marginX, y);

    autoTable(doc, {
      startY: y + 2,
      margin: { left: marginX, right: marginX },
      theme: 'grid',
      styles: {
        fontSize: matrixFontSize,
        cellPadding: 1.8,
        lineColor: [15, 23, 42],
        lineWidth: 0.2,
      },
      headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
      head: [matrixHead],
      body: matrixBody,
      foot: [matrixFoot],
    });

    y = ((doc as any).lastAutoTable?.finalY || y + 20) + 6;
    if (y > 165) {
      doc.addPage();
      y = 16;
    }

    // Credentials
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('CREDENCIAIS DOS PARTICIPANTES', marginX, y);

    autoTable(doc, {
      startY: y + 2,
      margin: { left: marginX, right: marginX },
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 2, lineColor: [15, 23, 42], lineWidth: 0.2 },
      headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
      head: [['Nome', 'Apelido', 'CPF / CNPJ', 'CRECI', 'Cargo na Operação']],
      body:
        credentials.length > 0
          ? credentials.map((c) => [c.nome, c.apelido, c.cpf, c.creci, c.cargo])
          : [['Nenhum participante nomeado vinculado.', '-', '-', '-', '-']],
    });

    y = ((doc as any).lastAutoTable?.finalY || y + 20) + 6;
    if (y > 180) {
      doc.addPage();
      y = 16;
    }

    if (observacao && observacao.trim()) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const obsLines = doc.splitTextToSize(`Observações: ${observacao.trim()}`, pageWidth - marginX * 2);
      doc.text(obsLines, marginX, y);
      y += obsLines.length * 4 + 3;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(
      `Total Distribuído: ${fmtBRL(totalDistribuido)}   |   Saldo Remanescente Sem Cobertura: ${fmtBRL(
        waterfall.saldoRestanteComissao
      )}`,
      pageWidth - marginX,
      y,
      { align: 'right' }
    );
  }

  const slug = (title || 'documento')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  doc.save(`${filenamePrefix}_${mode}_${slug || 'geral'}.pdf`);
}

export interface WebropayPdfParams {
  title: string;
  subtitle?: string;
  acordoCode?: string;
  parcelas: Array<{ numero: number; vencimento: string; valorTotalParcela: number }>;
  beneficiarios: Array<{ nomeComissionado: string; cpfCnpj: string; parcelas: number[]; total: number }>;
  totaisPorParcela: number[];
  totalGeralDistribuido: number;
  pagadorFields: Array<{ label: string; displayValue: string }>;
  filenamePrefix?: string;
}

export function generateWebropayPdf(params: WebropayPdfParams): void {
  const {
    title,
    subtitle,
    acordoCode,
    parcelas,
    beneficiarios,
    totaisPorParcela,
    totalGeralDistribuido,
    pagadorFields,
    filenamePrefix = 'planilha_webropay_acordo',
  } = params;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 12;

  const hasLogo = addLogoToJsPdf(doc, marginX, 7.5, 14);
  const titleX = hasLogo ? marginX + 17 : marginX;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(`PLANILHA WEBROPAY — ${title}`, titleX, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  if (subtitle) {
    doc.text(subtitle, titleX, 19);
  }
  const rightMeta = acordoCode
    ? `${acordoCode}  •  Emitido em: ${new Date().toLocaleString('pt-BR')}`
    : `Emitido em: ${new Date().toLocaleString('pt-BR')}`;
  doc.text(rightMeta, pageWidth - marginX, 14, { align: 'right' });

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.5);
  doc.line(marginX, 23, pageWidth - marginX, 23);

  let y = 28;

  // Bloco 1: Beneficiários (chunking a cada 8 parcelas para manter legibilidade impecável em A4 Paisagem)
  const chunkSize = 8;
  const totalChunks = Math.max(1, Math.ceil(parcelas.length / chunkSize));

  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    if (chunkIdx > 0) {
      doc.addPage();
      y = 16;
    }

    const startIdx = chunkIdx * chunkSize;
    const endIdx = Math.min(parcelas.length, startIdx + chunkSize);
    const sliceParcelas = parcelas.slice(startIdx, endIdx);
    const isLastChunk = chunkIdx === totalChunks - 1;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    const chunkLabel =
      totalChunks > 1
        ? `ABA 1: BENEFICIÁRIOS — RATEIO DAS COMISSÕES (PARCELAS ${startIdx + 1} A ${endIdx} DE ${parcelas.length})`
        : 'ABA 1: BENEFICIÁRIOS — RATEIO DAS COMISSÕES (MODELO WEBROPAY)';
    doc.text(chunkLabel, marginX, y);

    const headRow = [
      'Nome do Comissionado',
      'CPF/CNPJ',
      ...sliceParcelas.map((p) => `Parcela ${p.numero}\n${p.vencimento}`),
      ...(isLastChunk ? ['Total'] : []),
    ];

    const bodyRows = beneficiarios.map((b) => [
      b.nomeComissionado,
      b.cpfCnpj || '-',
      ...sliceParcelas.map((_, i) => {
        const val = b.parcelas[startIdx + i] || 0;
        return val > 0 ? fmtBRL(val) : '-';
      }),
      ...(isLastChunk ? [fmtBRL(b.total)] : []),
    ]);

    const footRow = [
      'TOTAL CONFERÊNCIA',
      `${beneficiarios.length} benef.`,
      ...sliceParcelas.map((_, i) => fmtBRL(totaisPorParcela[startIdx + i] || 0)),
      ...(isLastChunk ? [fmtBRL(totalGeralDistribuido)] : []),
    ];

    const colStyles: Record<number, any> = {
      0: { halign: 'left', cellWidth: 'auto' },
      1: { halign: 'center' },
    };
    for (let c = 2; c < headRow.length; c++) {
      colStyles[c] = { halign: 'right' };
    }

    autoTable(doc, {
      startY: y + 2.5,
      margin: { left: marginX, right: marginX },
      theme: 'grid',
      styles: {
        fontSize: sliceParcelas.length > 6 ? 7 : 7.8,
        cellPadding: 2,
        textColor: [15, 23, 42],
        lineColor: [15, 23, 42],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center',
      },
      footStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
      },
      columnStyles: colStyles,
      head: [headRow],
      body: bodyRows,
      foot: [footRow],
    });

    y = ((doc as any).lastAutoTable?.finalY || y + 30) + 7;
  }

  // Bloco 2: Dados do Pagador (Layout em 2 pares de colunas para compactação elegante em A4 Paisagem)
  if (y > 142) {
    doc.addPage();
    y = 16;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('ABA 2: DADOS DO PAGADOR (MODELO WEBROPAY)', marginX, y);

  const half = Math.ceil(pagadorFields.length / 2);
  const pagadorRows: string[][] = [];
  for (let i = 0; i < half; i++) {
    const left = pagadorFields[i];
    const right = pagadorFields[i + half];
    pagadorRows.push([
      left ? left.label : '',
      left ? left.displayValue : '',
      right ? right.label : '',
      right ? right.displayValue : '',
    ]);
  }

  autoTable(doc, {
    startY: y + 2.5,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    styles: {
      fontSize: 7.8,
      cellPadding: 2,
      textColor: [15, 23, 42],
      lineColor: [15, 23, 42],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [248, 250, 252], cellWidth: 42 },
      1: { cellWidth: 94 },
      2: { fontStyle: 'bold', fillColor: [248, 250, 252], cellWidth: 42 },
      3: { cellWidth: 'auto' },
    },
    head: [['Campo', 'Informação', 'Campo', 'Informação']],
    body: pagadorRows,
  });

  const slug = (title || 'acordo')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  doc.save(`${filenamePrefix}_${slug || 'geral'}.pdf`);
}
