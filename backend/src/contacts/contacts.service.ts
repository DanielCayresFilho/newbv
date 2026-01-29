import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) { }

  async create(createContactDto: CreateContactDto) {
    // Tentar encontrar ou criar o contato (upsert se tiver ID seria ideal, mas aqui é create)
    // Como phone é unique, vamos verificar se já existe
    const existingContact = await this.prisma.contact.findUnique({
      where: { phone: createContactDto.phone },
    });

    if (existingContact) {
      // Se o contato já existe, podemos atualizá-lo ou apenas retorná-lo.
      // Vamos atualizar os dados para garantir que estão recentes
      const updated = await this.prisma.contact.update({
        where: { id: existingContact.id },
        data: createContactDto,
      });

      // Atualizar conversas
      if (createContactDto.name && createContactDto.name.trim() !== '') {
        await this.prisma.conversation.updateMany({
          where: {
            contactPhone: existingContact.phone,
            contactName: 'Desconhecido',
          },
          data: { contactName: createContactDto.name },
        });
      }
      return updated;
    }

    // Se não existe, criar
    const contact = await this.prisma.contact.create({
      data: createContactDto,
    });

    // Se existe nome, atualizar todas as conversas com "Desconhecido" para este telefone
    if (createContactDto.name && createContactDto.name.trim() !== '') {
      await this.prisma.conversation.updateMany({
        where: {
          contactPhone: contact.phone,
          contactName: 'Desconhecido',
        },
        data: { contactName: createContactDto.name },
      });
    }

    return contact;
  }

  async findAll(search?: string, segment?: number) {
    return this.prisma.contact.findMany({
      where: {
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { cpf: { contains: search } },
          ],
        }),
        ...(segment && { segment }),
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: number) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
    });

    if (!contact) {
      throw new NotFoundException(`Contato com ID ${id} não encontrado`);
    }

    return contact;
  }

  async findByPhone(phone: string) {
    return this.prisma.contact.findFirst({
      where: { phone },
    });
  }

  async update(id: number, updateContactDto: UpdateContactDto) {
    const contact = await this.findOne(id);

    // Atualizar o contato
    const updatedContact = await this.prisma.contact.update({
      where: { id },
      data: updateContactDto,
    });

    // Se o nome foi alterado, atualizar contactName em todas as conversas relacionadas
    if (updateContactDto.name !== undefined && updateContactDto.name !== contact.name) {
      await this.prisma.conversation.updateMany({
        where: { contactPhone: contact.phone },
        data: { contactName: updateContactDto.name },
      });
    }

    return updatedContact;
  }

  // Atualizar contato por telefone (útil para atualizar durante atendimento)
  async updateByPhone(phone: string, updateContactDto: UpdateContactDto) {
    const contact = await this.findByPhone(phone);

    if (!contact) {
      throw new NotFoundException(`Contato com telefone ${phone} não encontrado`);
    }

    // Se marcando como CPC, atualizar lastCPCAt
    if (updateContactDto.isCPC === true) {
      (updateContactDto as any).lastCPCAt = new Date();
    } else if (updateContactDto.isCPC === false) {
      (updateContactDto as any).lastCPCAt = null;
    }

    // Se o nome está sendo atualizado, marcar como manual para evitar sobrescrita automática
    if (updateContactDto.name !== undefined && updateContactDto.name !== contact.name) {
      (updateContactDto as any).isNameManual = true;
    }

    // Atualizar o contato
    const updatedContact = await this.prisma.contact.update({
      where: { id: contact.id },
      data: updateContactDto,
    });

    // Se o nome foi alterado, atualizar contactName em todas as conversas relacionadas
    if (updateContactDto.name !== undefined && updateContactDto.name !== contact.name) {
      await this.prisma.conversation.updateMany({
        where: { contactPhone: phone },
        data: { contactName: updateContactDto.name },
      });
    }

    return updatedContact;
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.contact.delete({
      where: { id },
    });
  }
}
