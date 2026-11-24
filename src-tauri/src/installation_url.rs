use reqwest::Url;

/// Accept only the canonical form shared by the transport and the installation registry.
pub(crate) fn parse_canonical(base: &str) -> Option<Url> {
    let url = Url::parse(base).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.has_host()
        || has_credentials(&url)
        || url.query().is_some()
        || url.fragment().is_some()
        || url.as_str().trim_end_matches('/') != base
        || base.contains("%00")
    {
        return None;
    }
    Some(url)
}

pub(crate) fn has_credentials(url: &Url) -> bool {
    !url.username().is_empty() || url.password().is_some()
}
