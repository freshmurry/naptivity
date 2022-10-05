# Geocoder.configure(
#   lookup: :google,
#   http_proxy: ENV['QUOTAGUARD_URL'],
#   always_raise: [
#     Geocoder::OverQueryLimitError,
#     Geocoder::RequestDenied,
#     Geocoder::InvalidRequest,
#     Geocoder::InvalidApiKey
#   ]
# )

Geocoder.configure(
  units: :mi,
  :timeout=>15
)

Geocoder::Configuration.timeout = 15