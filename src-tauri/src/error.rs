use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, AppError>;

/// Errors that cross to the frontend as `{ "kind": "...", "message": "..." }`.
#[derive(Debug)]
pub enum AppError {
    /// The path escapes the workspace root (or is absolute / malformed).
    OutsideWorkspace,
    /// A file or folder name is empty, has separators or starts with a dot.
    InvalidName(String),
    /// The target does not exist.
    NotFound(String),
    /// The operation does not apply to this entry (e.g. reading a folder).
    Invalid(String),
    /// Underlying filesystem or settings error.
    Io(String),
    /// Something already exists at the destination; the text is the full Spanish message.
    AlreadyExists(String),
    /// No Claude Code binary could be found or started.
    ClaudeNotFound,
    /// A ready-to-show Spanish message with no prefix.
    Custom(String),
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::OutsideWorkspace => "outside_workspace",
            AppError::InvalidName(_) => "invalid_name",
            AppError::NotFound(_) => "not_found",
            AppError::Invalid(_) => "invalid",
            AppError::Io(_) => "io",
            AppError::AlreadyExists(_) => "exists",
            AppError::ClaudeNotFound => "claude_not_found",
            AppError::Custom(_) => "custom",
        }
    }

    pub fn message(&self) -> String {
        match self {
            AppError::OutsideWorkspace => "Esa ruta queda fuera del espacio de trabajo.".into(),
            AppError::InvalidName(why) => format!("Nombre no válido: {why}."),
            AppError::NotFound(what) => format!("No se encontró: {what}."),
            AppError::Invalid(why) => format!("Operación no válida: {why}."),
            AppError::Io(e) => format!("No se pudo completar la operación: {e}"),
            AppError::AlreadyExists(msg) | AppError::Custom(msg) => msg.clone(),
            AppError::ClaudeNotFound => {
                "No encuentro Claude Code. Instálalo e inicia sesión, o indica su ruta en Ajustes.".into()
            }
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message())
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound("el archivo o carpeta".into())
        } else {
            AppError::Io(e.to_string())
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.message())?;
        st.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_kind_and_spanish_message() {
        let v = serde_json::to_value(AppError::OutsideWorkspace).unwrap();
        assert_eq!(v["kind"], "outside_workspace");
        assert!(v["message"].as_str().unwrap().contains("fuera"));
    }
}
