use std::net::SocketAddr;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    pub client_dist: String,
}

impl Config {
    pub fn from_env() -> Self {
        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://genesis:genesis@localhost:5432/genesis".to_string());
        let bind_addr: SocketAddr = std::env::var("BIND_ADDR")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| "127.0.0.1:8080".parse().expect("default bind addr parses"));
        let client_dist =
            std::env::var("CLIENT_DIST").unwrap_or_else(|_| "client/dist".to_string());
        Self {
            database_url,
            bind_addr,
            client_dist,
        }
    }
}
