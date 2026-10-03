/** 爬虫内部共享的错误类型。 */

export class SkipError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'SkipError';
    this.reason = reason;
  }
}