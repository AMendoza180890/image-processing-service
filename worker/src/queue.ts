import { ReceiveMessageCommand, DeleteMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";

/** Un mensaje recibido de la cola, con lo mínimo que el worker necesita. */
export interface QueueMessage {
  body: string;
  receiptHandle: string;
}

/**
 * Cola de trabajos (SQS) desde el lado consumidor. Interfaz para inyectar un
 * doble en tests.
 */
export interface JobQueue {
  /** Long-polling: espera hasta `waitSeconds` a que lleguen mensajes. */
  receiveMessages(waitSeconds: number): Promise<QueueMessage[]>;
  deleteMessage(receiptHandle: string): Promise<void>;
}

export class SqsJobQueue implements JobQueue {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async receiveMessages(waitSeconds: number): Promise<QueueMessage[]> {
    const res = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: waitSeconds,
      }),
    );
    return (res.Messages ?? [])
      .filter((m) => m.Body != null && m.ReceiptHandle != null)
      .map((m) => ({ body: m.Body as string, receiptHandle: m.ReceiptHandle as string }));
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle }),
    );
  }
}
