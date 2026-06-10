import { defineChain } from 'viem'

export const somniaTestnet = defineChain({
  id: 50312,
  name: 'Somnia Testnet',
  nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://api.infra.testnet.somnia.network'] },
  },
  blockExplorers: {
    default: {
      // Blockscout instance that indexes this chain AND has our verified contracts.
      name: 'Somnia Explorer',
      url: 'https://somnia.w3us.site',
    },
  },
  testnet: true,
})
