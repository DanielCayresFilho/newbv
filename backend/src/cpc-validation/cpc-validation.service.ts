import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { AppLoggerService } from '../logger/logger.service';

export interface CpcApiResponse {
  sucesso: boolean;
  mensagem: string;
}

export interface CanContactResult {
  allowed: boolean;
  reason: string;
}

@Injectable()
export class CpcValidationService {
  private readonly apiUrl: string;
  private readonly apiUser: string;
  private readonly apiPassword: string;
  private readonly enabled: boolean;
  private readonly authHeader: string;

  constructor(
    private configService: ConfigService,
    private logger: AppLoggerService,
  ) {
    this.apiUrl = this.configService.get<string>('CPC_API_URL') || '';
    this.apiUser = this.configService.get<string>('CPC_API_USER') || 'Vend';
    this.apiPassword = this.configService.get<string>('CPC_API_PASSWORD') || '';
    this.enabled = this.configService.get<string>('CPC_API_ENABLED') === 'true';

    // Gerar header de autenticação Basic
    const credentials = `${this.apiUser}:${this.apiPassword}`;
    this.authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;

    if (this.enabled) {
      this.logger.log(
        `CPC Validation Service inicializado - URL: ${this.apiUrl}`,
        'CpcValidationService',
      );
    }
  }

  /**
   * Verifica se o serviço está habilitado
   */
  isEnabled(): boolean {
    return this.enabled && !!this.apiUrl;
  }

  /**
   * Remove prefixo 55 do telefone para enviar à API do parceiro
   */
  private formatPhoneForPartner(phone: string): string {
    // Remove caracteres não numéricos
    let cleanPhone = phone.replace(/\D/g, '');
    // Remove prefixo 55 se existir
    if (cleanPhone.startsWith('55') && cleanPhone.length > 11) {
      cleanPhone = cleanPhone.substring(2);
    }
    return cleanPhone;
  }

  /**
   * Valida se o contrato existe na base do parceiro
   */
  async validateContract(
    contract: string,
    segment: string,
    phone?: string,
  ): Promise<CpcApiResponse> {
    if (!this.isEnabled()) {
      return { sucesso: true, mensagem: 'CPC API desabilitada' };
    }

    try {
      // Usar encodeURIComponent para garantir %20 em vez de + para espaços
      let queryString = `contrato=${encodeURIComponent(contract)}&segmento=${encodeURIComponent(segment)}`;
      if (phone) {
        const formattedPhone = this.formatPhoneForPartner(phone);
        queryString += `&telefone=${encodeURIComponent(formattedPhone)}`;
      }

      const fullUrl = `${this.apiUrl}/validate-contract?${queryString}`;
      this.logger.log(
        `[CPC REQUEST] GET ${fullUrl}`,
        'CpcValidationService',
      );

      const response = await axios.get<CpcApiResponse>(
        fullUrl,
        {
          headers: {
            'Authorization': this.authHeader,
          },
          timeout: 30000,
        },
      );

      this.logger.log(
        `validate-contract: contrato=${contract}, segmento=${segment} => ${response.data.mensagem}`,
        'CpcValidationService',
      );

      return response.data;
    } catch (error) {
      return this.handleApiError(error, 'validate-contract');
    }
  }

  /**
   * Verifica se já existe acionamento CPC no dia para o telefone/contrato
   */
  async checkAcionamento(
    contract: string,
    phone: string,
    segment: string,
  ): Promise<CpcApiResponse> {
    if (!this.isEnabled()) {
      return { sucesso: true, mensagem: 'CPC API desabilitada' };
    }

    try {
      // Usar encodeURIComponent para garantir %20 em vez de + para espaços
      const formattedPhone = this.formatPhoneForPartner(phone);
      const queryString = `contrato=${encodeURIComponent(contract)}&telefone=${encodeURIComponent(formattedPhone)}&segmento=${encodeURIComponent(segment)}`;

      const fullUrl = `${this.apiUrl}/check-acionamento?${queryString}`;
      this.logger.log(
        `[CPC REQUEST] GET ${fullUrl}`,
        'CpcValidationService',
      );

      const response = await axios.get<CpcApiResponse>(
        fullUrl,
        {
          headers: {
            'Authorization': this.authHeader,
          },
          timeout: 30000,
        },
      );

      this.logger.log(
        `check-acionamento: contrato=${contract}, telefone=${phone}, segmento=${segment} => ${response.data.mensagem}`,
        'CpcValidationService',
      );

      return response.data;
    } catch (error) {
      return this.handleApiError(error, 'check-acionamento');
    }
  }

  /**
   * Registra um novo acionamento CPC
   */
  async registerAcionamento(
    contract: string,
    phone: string,
    segment: string,
  ): Promise<CpcApiResponse> {
    if (!this.isEnabled()) {
      return { sucesso: true, mensagem: 'CPC API desabilitada' };
    }

    try {
      const fullUrl = `${this.apiUrl}/register-acionamento`;
      const formattedPhone = this.formatPhoneForPartner(phone);
      const payload = {
        telefone: formattedPhone,
        contrato: contract,
        segmento: segment,
      };

      this.logger.log(
        `[CPC REQUEST] POST ${fullUrl} | Payload: ${JSON.stringify(payload)}`,
        'CpcValidationService',
      );

      const response = await axios.post<CpcApiResponse>(
        fullUrl,
        payload,
        {
          headers: {
            'Authorization': this.authHeader,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      this.logger.log(
        `register-acionamento: contrato=${contract}, telefone=${phone}, segmento=${segment} => ${response.data.mensagem}`,
        'CpcValidationService',
      );

      return response.data;
    } catch (error) {
      return this.handleApiError(error, 'register-acionamento');
    }
  }

  /**
   * Método completo: valida contrato e verifica se pode contactar
   * Retorna se o contato pode ser acionado ou não
   */
  async canContact(
    contract: string,
    phone: string,
    segment: string,
  ): Promise<CanContactResult> {
    if (!this.isEnabled()) {
      return { allowed: true, reason: 'CPC API desabilitada' };
    }

    // 1. Validar se o contrato existe
    const contractValidation = await this.validateContract(contract, segment, phone);
    if (!contractValidation.sucesso) {
      return {
        allowed: false,
        reason: contractValidation.mensagem,
      };
    }

    // 2. Verificar se já existe acionamento no dia
    const acionamentoCheck = await this.checkAcionamento(contract, phone, segment);
    if (!acionamentoCheck.sucesso) {
      return {
        allowed: false,
        reason: acionamentoCheck.mensagem,
      };
    }

    return {
      allowed: true,
      reason: 'Cliente pode ser acionado',
    };
  }

  /**
   * Tratamento de erros da API
   */
  private handleApiError(error: unknown, endpoint: string): CpcApiResponse {
    const axiosError = error as AxiosError<CpcApiResponse>;

    if (axiosError.response) {
      // Servidor respondeu com erro
      const errorData = axiosError.response.data;
      this.logger.error(
        `CPC API ${endpoint} erro: ${axiosError.response.status} - ${JSON.stringify(errorData)}`,
        axiosError.stack,
        'CpcValidationService',
      );

      return {
        sucesso: false,
        mensagem: errorData?.mensagem || `Erro na API: ${axiosError.response.status}`,
      };
    } else if (axiosError.request) {
      // Sem resposta do servidor
      this.logger.error(
        `CPC API ${endpoint} timeout/sem resposta`,
        axiosError.stack,
        'CpcValidationService',
      );

      return {
        sucesso: false,
        mensagem: 'API CPC indisponível - timeout',
      };
    } else {
      // Erro de configuração
      this.logger.error(
        `CPC API ${endpoint} erro de configuração: ${axiosError.message}`,
        axiosError.stack,
        'CpcValidationService',
      );

      return {
        sucesso: false,
        mensagem: `Erro interno: ${axiosError.message}`,
      };
    }
  }
}
