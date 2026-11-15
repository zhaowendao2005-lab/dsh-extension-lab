/** Error type shared by the a6api surfaces: carries a stable machine code the remote layer forwards. */
export class A6Error extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'A6Error';
    this.code = code;
  }
}
