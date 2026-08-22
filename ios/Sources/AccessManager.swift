import Foundation
import StoreKit

/// Freemium access manager. The core Tidyset workflow is free forever; Pro
/// (yearly recommended, monthly available, both with a 7-day free trial)
/// unlocks the premium features the web layer gates via the bridge `state`.
/// When a subscription lapses nothing is deleted — `hasAccess` simply
/// returns to false and premium surfaces re-lock.
@MainActor
final class AccessManager: ObservableObject {
    static let shared = AccessManager()

    static let yearlyID = "com.lukemclaughlin.tidyset.yearly"
    static let monthlyID = "com.lukemclaughlin.tidyset.monthly"

    @Published private(set) var hasAccess = false
    @Published private(set) var yearly: Product?
    @Published private(set) var monthly: Product?
    @Published private(set) var trialEligible = false
    var onChange: (() -> Void)?

    private var updatesTask: Task<Void, Never>?

    private init() {
        #if DEBUG
        if ProcessInfo.processInfo.environment["TIDYSET_DEMO"] == "1" {
            hasAccess = true
        }
        #endif
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                if case .verified(let t) = update {
                    await t.finish()
                }
                await self?.refresh()
            }
        }
        Task { await refresh() }
    }

    deinit { updatesTask?.cancel() }

    var state: [String: Any] {
        [
            "hasAccess": hasAccess,
            "isPurchased": hasAccess,
            "isTrialActive": false,
            "daysRemaining": 0,
            "yearlyPrice": yearly?.displayPrice ?? "$29.99",
            "monthlyPrice": monthly?.displayPrice ?? "$4.99",
            "trialEligible": trialEligible,
        ]
    }

    func refresh() async {
        if yearly == nil || monthly == nil {
            let loaded = (try? await Product.products(for: [Self.yearlyID, Self.monthlyID])) ?? []
            yearly = loaded.first { $0.id == Self.yearlyID }
            monthly = loaded.first { $0.id == Self.monthlyID }
            if let sub = yearly?.subscription {
                trialEligible = await sub.isEligibleForIntroOffer
            }
        }
        var owned = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result, t.revocationDate == nil,
               t.productID == Self.yearlyID || t.productID == Self.monthlyID {
                owned = true
            }
        }
        if hasAccess != owned {
            hasAccess = owned
            onChange?()
        }
    }

    /// Bridge entry: plan is "yearly" (default/recommended) or "monthly".
    func purchase(plan: String) async -> Bool {
        await refresh()
        let product = plan.lowercased().contains("month") ? monthly : yearly
        guard let product else { return false }
        guard let result = try? await product.purchase() else { return false }
        if case .success(let verification) = result, case .verified(let t) = verification {
            await t.finish()
            hasAccess = true
            onChange?()
            return true
        }
        return false
    }

    func restore() async -> Bool {
        try? await AppStore.sync()
        await refresh()
        return hasAccess
    }
}
