export const PUSH_QUEUE = 'push-delivery';

export type PushJob =
  | { type: 'send'; deliveryId: string }
  | { type: 'receipt'; deliveryId: string };
