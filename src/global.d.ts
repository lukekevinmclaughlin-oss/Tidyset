export {}

declare global {
  type AccessState = {
    hasAccess: boolean
    isPurchased: boolean
    isTrialActive: boolean
    daysRemaining: number
    price: string
    monthlyPrice: string
    yearlyPrice: string
  }
  interface Window {
    tidyset: {
      openFile: () => Promise<{ path: string; name: string; bytes: ArrayBuffer } | null>
      readFile: (path: string) => Promise<ArrayBuffer>
      saveFile: (defaultName: string, data: ArrayBuffer | string) => Promise<string | null>
      getTheme: () => Promise<'dark' | 'light'>
      getAccess: () => Promise<AccessState>
      purchaseSubscription: (plan: 'monthly' | 'yearly') => Promise<boolean>
      restorePurchases: () => Promise<boolean>
      openExternal: (url: string) => Promise<boolean>
      onAccessChanged: (listener: (state: AccessState) => void) => () => void
    }
  }
}
