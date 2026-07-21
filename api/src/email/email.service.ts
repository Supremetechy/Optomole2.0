import { BadRequestException, Injectable } from '@nestjs/common';
import net from 'node:net';
import tls from 'node:tls';

export interface EmailInboxConnectRequest {
  protocol?: 'imap' | 'pop3' | string;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  mailbox?: string;
  limit?: number;
}

@Injectable()
export class EmailService {
  async connectInbox(input: EmailInboxConnectRequest) {
    const protocol = String(input.protocol || '').toLowerCase();
    if (!['imap', 'pop3'].includes(protocol)) {
      throw new BadRequestException('protocol must be imap or pop3.');
    }
    if (!input.host || !String(input.host).trim()) {
      throw new BadRequestException('host is required.');
    }
    if (!input.username || !String(input.username).trim()) {
      throw new BadRequestException('username is required.');
    }

    const port = Number(input.port || (protocol === 'imap' ? 993 : 995));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadRequestException('port must be between 1 and 65535.');
    }

    const limit = Math.min(Math.max(Number(input.limit || 25), 1), 100);
    const mailbox = String(input.mailbox || 'INBOX').trim() || 'INBOX';
    const host = String(input.host).trim();
    const username = String(input.username).trim();
    const connectedAt = new Date().toISOString();
    const verification = input.password
      ? await this.verifyConnection({ protocol, host, port, secure: input.secure !== false, username, password: input.password, mailbox })
      : { ok: false, status: 'not_verified', message: 'Password was not provided, so login was not tested.' };

    return {
      ok: true,
      source: {
        sourceType: 'inbox',
        title: `${protocol.toUpperCase()} inbox: ${mailbox}`,
        text: [
          `${protocol.toUpperCase()} inbox connection registered for ${username} at ${host}:${port}.`,
          `Mailbox: ${mailbox}. Message import limit: ${limit}.`,
          'Use this inbox as a live source for quest generation, triage practice, and evidence extraction.',
        ].join('\n'),
        origin: `${protocol}-inbox-connection`,
        metadata: {
          protocol,
          host,
          port,
          secure: input.secure !== false,
          username,
          mailbox,
          limit,
          connectedAt,
          passwordProvided: Boolean(input.password),
          credentialsStored: false,
          importStatus: verification.ok ? 'connection-verified' : 'connection-registered',
          verification,
        },
      },
    };
  }

  private async verifyConnection(input: {
    protocol: string;
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    mailbox: string;
  }): Promise<{ ok: boolean; status: string; message: string }> {
    try {
      if (input.protocol === 'imap') {
        await this.verifyImap(input);
      } else {
        await this.verifyPop3(input);
      }
      return { ok: true, status: 'verified', message: `${input.protocol.toUpperCase()} login succeeded.` };
    } catch (error) {
      return { ok: false, status: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
  }

  private verifyImap(input: { host: string; port: number; secure: boolean; username: string; password: string; mailbox: string }) {
    return this.withMailSocket(input, async (socket, readLine, writeLine) => {
      const greeting = await readLine();
      if (!greeting.includes('* OK')) throw new Error(`IMAP greeting failed: ${greeting}`);
      writeLine(`a1 LOGIN ${this.imapQuoted(input.username)} ${this.imapQuoted(input.password)}`);
      const login = await this.readUntilTagged(readLine, 'a1');
      if (!/^a1 OK/i.test(login)) throw new Error(`IMAP login failed: ${login}`);
      writeLine(`a2 SELECT ${this.imapQuoted(input.mailbox)}`);
      const select = await this.readUntilTagged(readLine, 'a2');
      if (!/^a2 OK/i.test(select)) throw new Error(`IMAP mailbox select failed: ${select}`);
      writeLine('a3 LOGOUT');
      socket.end();
    });
  }

  private verifyPop3(input: { host: string; port: number; secure: boolean; username: string; password: string }) {
    return this.withMailSocket(input, async (socket, readLine, writeLine) => {
      const greeting = await readLine();
      if (!greeting.startsWith('+OK')) throw new Error(`POP3 greeting failed: ${greeting}`);
      writeLine(`USER ${input.username}`);
      const user = await readLine();
      if (!user.startsWith('+OK')) throw new Error(`POP3 username rejected: ${user}`);
      writeLine(`PASS ${input.password}`);
      const pass = await readLine();
      if (!pass.startsWith('+OK')) throw new Error(`POP3 login failed: ${pass}`);
      writeLine('STAT');
      await readLine();
      writeLine('QUIT');
      socket.end();
    });
  }

  private withMailSocket(
    input: { host: string; port: number; secure: boolean },
    callback: (
      socket: net.Socket | tls.TLSSocket,
      readLine: () => Promise<string>,
      writeLine: (line: string) => void,
    ) => Promise<void>,
  ) {
    return new Promise<void>((resolve, reject) => {
      const socket = input.secure
        ? tls.connect({ host: input.host, port: input.port, servername: input.host })
        : net.connect({ host: input.host, port: input.port });
      let buffer = '';
      const pending: Array<(line: string) => void> = [];
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Mail server connection timed out.'));
      }, 12000);

      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        buffer += chunk;
        let index = buffer.indexOf('\n');
        while (index >= 0 && pending.length) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          pending.shift()?.(line);
          index = buffer.indexOf('\n');
        }
      });
      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      const readLine = () => new Promise<string>((lineResolve) => {
        const index = buffer.indexOf('\n');
        if (index >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          lineResolve(line);
          return;
        }
        pending.push(lineResolve);
      });
      const writeLine = (line: string) => socket.write(`${line}\r\n`);

      callback(socket, readLine, writeLine)
        .then(() => {
          clearTimeout(timeout);
          resolve();
        })
        .catch((error) => {
          clearTimeout(timeout);
          socket.destroy();
          reject(error);
        });
    });
  }

  private async readUntilTagged(readLine: () => Promise<string>, tag: string) {
    let last = '';
    for (let index = 0; index < 20; index += 1) {
      last = await readLine();
      if (last.toLowerCase().startsWith(tag.toLowerCase())) return last;
    }
    return last;
  }

  private imapQuoted(value: string) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
}
