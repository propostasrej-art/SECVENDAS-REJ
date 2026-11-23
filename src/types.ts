export enum Type {
  TYPE_UNSPECIFIED = "TYPE_UNSPECIFIED",
  STRING = "STRING",
  NUMBER = "NUMBER",
  INTEGER = "INTEGER",
  BOOLEAN = "BOOLEAN",
  ARRAY = "ARRAY",
  OBJECT = "OBJECT",
  NULL = "NULL",
}

export interface DocumentState {
  id: string;
  name: string;
  file: File | null;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  required: boolean;
}

export interface PropertyData {
  empreendimento: string;
  unidade: string;
  torre: string;
  cidade?: string;
  estado?: string;
  localizacao?: string;
  endereco?: string;
}

export interface SalesTeam {
  corretor1: string;
  corretor2: string;
  gerente: string;
  diretor?: string;
  coordenador?: string;
}

export interface CustomerData {
  nome: string;
  cpf: string;
  telefone: string;
  email: string;
  dataNascimento: string;
  rgNumero: string;
  rgOrgao: string;
  rgDataExpedicao: string;
  estadoCivil: string;
  profissao: string;
  naturalidade: string;
  nacionalidade: string;
  address?: AddressData;
}

export interface AddressData {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
}

export interface PaymentInstallment {
  quantidade: number;
  tipo: string;
  valorUnitario: number;
  vencimento: string;
  valorTotal: number;
}

export interface StoredProposalFile {
  id: string;
  docId?: string;
  docType: string;
  fileName: string;
  contentType: string;
  size: number;
  storagePath: string;
  downloadUrl: string;
  uploadedAt: string;
  uploadedByUid: string;
}

export interface ClicksignSigner {
  id?: string;
  name: string;
  email: string;
  phone?: string;
  cpf?: string;
  role?: string;
  status?: string;
  signUrl?: string;
  signedAt?: string;
}

export interface ClicksignEnvelope {
  id: string;
  documentId?: string;
  proposalId?: string;
  documentName: string;
  envelopeName?: string;
  docType: 'contract' | 'proposal';
  status: string;
  rawStatus?: string;
  environment: 'sandbox' | 'production';
  isSimulation?: boolean;
  signers: ClicksignSigner[];
  viewUrl?: string;
  signedDownloadUrl?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ExtractionResult {
  id?: string;
  uid?: string;
  status?: ExtractionStatus;
  property: PropertyData;
  salesTeam: SalesTeam;
  customers: CustomerData[];
  address: AddressData;
  payments: PaymentInstallment[];
  validations: {
    cpfMatch: boolean;
    totalValueMatch: boolean;
    message?: string;
  };
  valorTotalProposta?: number;
  valorTotalComissao?: number;
  baseCalculoComissao?: number;
  valorBonusExcluido?: number;
  valorEntrada?: number;
  spreadsheet_id?: string;
  drive_link?: string;
  storage_folder?: string;
  stored_files?: StoredProposalFile[];
  clicksign_envelope_id?: string;
  clicksign_status?: string;
  proposta_status?: PropostaStatus;
  cvc_status?: CVCStatus;
  corretagem_status?: CorretagemStatus;
  forma_pagamento_comissao?: FormaPagamentoComissao;
  tipo_minuta_corretagem?: TipoMinutaCorretagem;
  informacoes_adicionais?: string;
  documents?: {
    type: string;
    found: boolean;
    description?: string;
  }[];
  commissionedParties?: any[];
  commissioned_parties?: any[];
  percentualComissao?: number;
  manual_waterfall?: any;
  simulationResult?: any;
  condicaoPreco?: any[];
  condicaoComissao?: any[];
}

export type ExtractionStatus = 'na fila' | 'devolvida com pendencia' | 'contrato enviado' | 'escriturada' | 'cancelada';

export type PropostaStatus = 'AGUARDANDO APROVAÇÃO' | 'APROVADA' | 'DEVOLVIDA' | 'CANCELADA' | 'ESCRITURADA';
export type CVCStatus = 'PENDENTE' | 'NA FILA' | 'ENVIADO' | 'ASSINADO' | 'CANCELADO';
export type CorretagemStatus = 'PENDENTE' | 'NA FILA' | 'ENVIADO' | 'ASSINADO' | 'CANCELADO' | 'DEVOLVIDO';
export type FormaPagamentoComissao = 'PAGADORIA' | 'NF/REPASSE' | 'PAGADORIA INCORPORADOR';
export type TipoMinutaCorretagem = 'PADRAO' | 'NF_REPASSE';

export interface SavedExtraction {
  id: string;
  property: PropertyData;
  sales_team: SalesTeam;
  customers: CustomerData[];
  address: AddressData;
  payments: PaymentInstallment[];
  validations: any;
  status: ExtractionStatus;
  proposta_status?: PropostaStatus;
  cvc_status?: CVCStatus;
  corretagem_status?: CorretagemStatus;
  forma_pagamento_comissao?: FormaPagamentoComissao;
  tipo_minuta_corretagem?: TipoMinutaCorretagem;
  informacoes_adicionais?: string;
  documents?: {
    type: string;
    found: boolean;
    description?: string;
  }[];
  created_at: string;
  updated_at?: string;
  valorTotalProposta?: number;
  valorTotalComissao?: number;
  baseCalculoComissao?: number;
  valorBonusExcluido?: number;
  valorEntrada?: number;
  spreadsheet_id?: string;
  drive_link?: string;
  storage_folder?: string;
  stored_files?: StoredProposalFile[];
  clicksign_envelope_id?: string;
  clicksign_status?: string;
  uid: string;
  commissioned_parties?: any[];
  commissionedParties?: any[];
  percentualComissao?: number;
  manual_waterfall?: any;
  simulationResult?: any;
  condicaoPreco?: any[];
  condicaoComissao?: any[];
}

export interface CargoCadastro {
  id: string;
  nome: string;
  apelido: string;
  creci: string;
  cpf_cnpj: string;
  cargo: string;
  gerente: string;
  diretor: string;
  telefone: string;
  email: string;
  pix: string;
  created_at: string;
  uid: string;
}

export interface ModeloRateioCargo {
  cargo: string;
  taxa_comissao: number;
  taxa_premio?: number;
  nome?: string;
}

export interface CommissionedParty {
  role: string;
  name: string;
  percentage: number;
  taxaPremio?: number;
  deduction?: number;
  hideAndSum?: boolean;
}

export interface Empreendimento {
  id: string;
  nome: string;
  construtora?: string;
  localizacao?: string;
  endereco?: string;
  tabela_base_id?: string; // ID da planilha no Sheets se houver
  status: 'ATIVO' | 'INATIVO';
  regras_comissao?: RegraComissao[];
  modelo_rateio?: ModeloRateioCargo[];
  created_at: string;
  uid: string;
}

export interface RegraComissao {
  parcela: string;
  tipo_deducao: 'VALOR' | 'PERCENTUAL';
  valor_deducao: number;
}

export interface InstallmentTypeConfig {
  id: string;
  descricao: string;
  periodicidade: number; // em meses
  created_at: string;
  uid: string;
}

export const EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    property: {
      type: Type.OBJECT,
      properties: {
        empreendimento: { type: Type.STRING },
        unidade: { type: Type.STRING },
        torre: { type: Type.STRING },
        cidade: { type: Type.STRING },
        estado: { type: Type.STRING },
        endereco: { type: Type.STRING },
      },
      required: ["empreendimento", "unidade"],
    },
    salesTeam: {
      type: Type.OBJECT,
      properties: {
        corretor1: { type: Type.STRING },
        corretor2: { type: Type.STRING },
        gerente: { type: Type.STRING },
      },
    },
    customers: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          nome: { type: Type.STRING },
          cpf: { type: Type.STRING },
          telefone: { type: Type.STRING },
          email: { type: Type.STRING },
          dataNascimento: { type: Type.STRING },
          rgNumero: { type: Type.STRING },
          rgOrgao: { type: Type.STRING },
          rgDataExpedicao: { type: Type.STRING },
          estadoCivil: { type: Type.STRING },
          profissao: { type: Type.STRING },
          naturalidade: { type: Type.STRING },
          nacionalidade: { type: Type.STRING },
          address: {
            type: Type.OBJECT,
            properties: {
              cep: { type: Type.STRING },
              logradouro: { type: Type.STRING },
              numero: { type: Type.STRING },
              complemento: { type: Type.STRING },
              bairro: { type: Type.STRING },
              cidade: { type: Type.STRING },
              estado: { type: Type.STRING },
            },
          },
        },
        required: ["nome", "cpf"],
      },
    },
    address: {
      type: Type.OBJECT,
      properties: {
        cep: { type: Type.STRING },
        logradouro: { type: Type.STRING },
        numero: { type: Type.STRING },
        complemento: { type: Type.STRING },
        bairro: { type: Type.STRING },
        cidade: { type: Type.STRING },
        estado: { type: Type.STRING },
      },
    },
    payments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          quantidade: { type: Type.INTEGER },
          tipo: { type: Type.STRING },
          valorUnitario: { type: Type.NUMBER },
          vencimento: { type: Type.STRING },
          valorTotal: { type: Type.NUMBER },
        },
        required: ["quantidade", "tipo", "valorUnitario", "valorTotal"],
      },
    },
    validations: {
      type: Type.OBJECT,
      properties: {
        cpfMatch: { type: Type.BOOLEAN },
        totalValueMatch: { type: Type.BOOLEAN },
        message: { type: Type.STRING },
      },
    },
    valorTotalProposta: { 
      type: Type.NUMBER,
      description: "O valor total da proposta/venda conforme indicado no documento."
    },
    valorEntrada: {
      type: Type.NUMBER,
      description: "O valor total das ENTRADAS (sinal, ato, princípio de pagamento) indicado no documento."
    },
    documents: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, description: "Tipo do documento (ex: RG, CPF, Proposta, Comprovante de Residência)" },
          found: { type: Type.BOOLEAN, description: "Se o documento foi identificado nos arquivos enviados" },
          description: { type: Type.STRING, description: "Breve descrição do que foi encontrado no documento" },
        },
        required: ["type", "found"],
      },
    },
  },
  required: ["property", "payments", "customers", "address", "valorTotalProposta"],
};
