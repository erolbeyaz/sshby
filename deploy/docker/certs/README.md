# Build sırasında güvenilecek ek CA sertifikaları

`corporate-ca.crt` dosyası, kurumsal ağdaki TLS kesme (SSL inspection) ağ geçidinin
kök sertifikasını içerir. Şu an içindeki sertifika:

| Alan        | Değer                                      |
| ----------- | ------------------------------------------ |
| Konu        | `CN=Forcepoint Cloud CA, O=Forcepoint LLC` |
| Parmak izi  | `93EC87F242AEDFC23FBA32C825C8FE094F5422FC` |
| Geçerlilik  | 2044-11-26                                 |

## Neden gerekli

Şirket ağında dışarı giden HTTPS trafiği Forcepoint Cloud Security Gateway
tarafından açılıp yeniden imzalanıyor. Docker imajlarının içindeki Node, bu ara
sertifikayı tanımadığı için `pnpm install` şu hatayla düşüyor:

```
Error: unable to get local issuer certificate (UNABLE_TO_GET_ISSUER_CERT_LOCALLY)
```

`node:22-bookworm-slim` imajında sistem CA deposu (`/etc/ssl/certs/ca-certificates.crt`)
bulunmuyor — Node kendi gömülü kök listesini kullanır. Bu yüzden
`update-ca-certificates` çalıştırmak yerine sertifikayı doğrudan
`NODE_EXTRA_CA_CERTS` ile tanıtıyoruz. Bu değişken **ek** kök tanımlar; Node'un
kendi kök listesini devre dışı bırakmaz.

Bu dosya bir sır değildir — kök sertifikanın açık anahtarıdır. Depoda tutulması
güvenlik açığı yaratmaz, ancak `strict-ssl=false` gibi doğrulamayı tümden kapatan
çözümlerden çok daha güvenlidir.

## Sertifika yenilendiğinde

Kök sertifika değişirse Windows sertifika deposundan yeniden çıkarın:

```powershell
$c = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -match 'Forcepoint' -and $_.NotAfter -gt (Get-Date) }
"-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($c.RawData,'InsertLineBreaks') + "`n-----END CERTIFICATE-----" |
  Set-Content deploy/docker/certs/corporate-ca.crt -Encoding ascii
```

Linux/macOS'ta zincirdeki kökü almak için:

```bash
openssl s_client -showcerts -connect registry.npmjs.org:443 </dev/null 2>/dev/null | openssl x509 -outform PEM
```

## Kesme yapılmayan ağda

Dosyayı boşaltmayın, silmeyin — `Dockerfile` onu kopyalamayı bekliyor. İçeriği
gereksizse dosyayı yalnızca bir yorum satırı bırakacak şekilde kısaltabilirsiniz;
`NODE_EXTRA_CA_CERTS` geçersiz olmayan boş bir dosyayı sorunsuz kabul eder.
