export class ConfirmEmailChangeDto {
  // token will be read from query in controller, but keep this DTO for body fields
  email!: string; // new email
  password?: string; // optional new password
}
