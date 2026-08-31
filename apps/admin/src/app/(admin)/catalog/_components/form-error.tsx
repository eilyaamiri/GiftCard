/**
 * Shared inline error banner for every create/edit form in catalog, services,
 * suppliers and quotes. `ApiClientError.message` is already the API's Persian
 * message — this only renders it, never swallows it.
 */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      style={{
        margin: "0 0 14px",
        padding: "11px 13px",
        borderRadius: "10px",
        background: "#fff5f5",
        border: "1px solid #f6dcdc",
        color: "#a83232",
        fontSize: "12px",
        lineHeight: 1.8,
      }}
    >
      {message}
    </p>
  );
}
