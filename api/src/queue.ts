import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { JobMessage } from "@app/types";

/**
 * Cola de trabajos (SQS). La API es el productor: publica `{ jobId }` para que
 * el worker lo consuma. Interfaz para inyectar un doble en tests.
 */
export interface JobQueue {
  publishJob(message: JobMessage): Promise<void>;
}

export class SqsJobQueue implements JobQueue {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async publishJob(message: JobMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify(message) }),
    );
  }
}
