import { exportJWK, generateKeyPair } from "jose";

/**
 * Gera o par de chaves EdDSA (Ed25519) usado para assinar o "offline grant"
 * (o JWT que autoriza um dispositivo a operar offline por N dias). Rode com
 * `npm run keys:generate` e cole a saída no seu `.env` local. Cada ambiente
 * (dev/staging/produção) deve ter o seu próprio par — nunca reaproveite.
 */
async function main() {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });

  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);

  const publicJson = JSON.stringify(publicJwk);
  const privateJson = JSON.stringify(privateJwk);

  console.log("\nAdicione estas linhas ao seu .env (nunca commit este .env):\n");
  console.log(`OFFLINE_GRANT_PRIVATE_KEY_JWK='${privateJson}'`);
  console.log(`OFFLINE_GRANT_PUBLIC_KEY_JWK='${publicJson}'`);
  console.log(
    "\nA chave pública também precisa estar disponível para o cliente verificar a" +
      " assinatura offline — exposta via NEXT_PUBLIC_OFFLINE_GRANT_PUBLIC_KEY_JWK" +
      " (mesmo valor de OFFLINE_GRANT_PUBLIC_KEY_JWK). Chaves públicas não são segredo.\n"
  );
  console.log(`NEXT_PUBLIC_OFFLINE_GRANT_PUBLIC_KEY_JWK='${publicJson}'\n`);
}

main().catch((err) => {
  console.error("Falha ao gerar chaves:", err);
  process.exit(1);
});
