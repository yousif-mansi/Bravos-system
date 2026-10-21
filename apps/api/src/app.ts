import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { Pool, type PoolClient } from "pg";
import {
  AnalyticsOperationConflictError,
  AnalyticsValidationError,
  createAnalyticsServices,
  type AnalyticsServices,
} from "@bravos/analytics";
import { createPostgresAnalyticsStore } from "@bravos/analytics/node";
import {
  ExpenseOperationConflictError,
  ExpenseRevisionConflictError,
  ExpensesValidationError,
  createExpenseServices,
  type ExpenseServices,
} from "@bravos/expenses";
import { createPostgresExpenseRepository } from "@bravos/expenses/node";
import { CorrectionsValidationError, createCorrectionServices, type CorrectionServices } from "@bravos/corrections";
import {
  createPostgresCorrectionsRepository,
  createPostgresReturnCorrectionStateReader,
  createPostgresStockReconciliationCorrectionFacts,
} from "@bravos/corrections/node";
import {
  CatalogValidationError,
  DuplicateProductCodeError,
  ReferencedVariantError,
  createCatalogServices,
  type CatalogServices,
} from "@bravos/catalog";
import { createLocalProductMediaStorage, createPostgresCatalogStore, createPostgresCheckoutCatalogReader, createPostgresListedPriceReader } from "@bravos/catalog/node";
import {
  InventoryValidationError,
  OperationConflictError,
  CoordinationStaleError,
  StockMutationPausedError,
  createInventoryAvailabilityReader,
  createInventoryServices,
  type InventoryServices,
} from "@bravos/inventory";
import {
  createInventoryTransaction,
  createPostgresInventoryStore,
  createPostgresStockCoordinationStore,
} from "@bravos/inventory/node";
import {
  ReceivingValidationError,
  createReceivingServices,
  type ReceivingServices,
} from "@bravos/receiving";
import {
  createPostgresReceiptCorrectionStore,
  createPostgresReceiptStore,
  createPostgresReceivingUnitOfWork,
} from "@bravos/receiving/node";
import {
  SaleRestoreGenerationChangedError,
  SaleRetainedForRestoreError,
  SalesValidationError,
  createExchangeReplacementPricing,
  createExchangeReplacementSaleWriter,
  createSalesServices,
  type SalesServices,
} from "@bravos/sales";
import {
  createPostgresPriceSnapshotStore,
  createPostgresPhysicalSaleSourceCandidateReader,
  createPostgresPricingQuoteReader,
  createPostgresSaleStore,
  createPostgresStockReconciliationSales,
  createPostgresSalesUnitOfWork,
  createPostgresDeferredCompletedSaleStore,
  createPostgresSalesRestorePort,
} from "@bravos/sales/node";
import {
  ReturnsValidationError,
  createReturnServices,
  type ReturnServices,
} from "@bravos/returns";
import {
  createPostgresReturnsStore,
  createPostgresReturnsUnitOfWork,
  createPostgresStockReconciliationReturnFacts,
} from "@bravos/returns/node";
import {
  StorefrontConfigValidationError,
  createStorefrontConfigServices,
  type StorefrontConfigServices,
} from "@bravos/storefront-config";
import { createPostgresStorefrontContactsStore } from "@bravos/storefront-config/node";
import {
  BranchNotAuthorizedError,
  DuplicateLoginNameError,
  ForbiddenError,
  IdentityValidationError,
  InvalidRecoveryError,
  NotFoundError,
  UnauthenticatedError,
  createIdentityServices,
} from "@bravos/identity";
import {
  awaitAuthReady,
  createBetterAuth,
  createBetterAuthIdentityProvider,
  createOwnerRecoveryOutbox,
  createPostgresStaffDirectory,
  operatorDirectoriesOverlap,
  prepareExternalOperatorDirectory,
  prepareOperatorRecoveryDirectory,
  resolveExternalOperatorDirectory,
  resolveOperatorRecoveryDirectory,
  type IdentityGateway,
} from "@bravos/identity/node";
import type { VerifiedAuth } from "@bravos/identity";
import { applyMigrations } from "@bravos/persistence";
import { CouponUsageConflictError, PricingValidationError, createPricingServices, type PricingServices } from "@bravos/pricing";
import {
  createPostgresAutomaticOfferStore,
  createPostgresAutomaticPricingReader,
  createPostgresCouponStore,
  createPostgresCouponUsageTransaction,
} from "@bravos/pricing/node";
import {
  InsufficientStockError,
  OnlineOrderOperationConflictError,
  OnlineOrderRevisionConflictError,
  OnlineOrderStateConflictError,
  OnlineOrderValidationError,
  QuoteAlreadyUsedError,
  QuoteStaleError,
  UnreachablePolicyError,
  UnsupportedDeliveryAreaError,
  VariantNotOrderableError,
  createOnlineOrderServices,
  type OnlineOrderServices,
} from "@bravos/online-orders";
import { createPostgresOnlineOrderStore, createPostgresOnlineOrderUnitOfWork } from "@bravos/online-orders/node";
import {
  OPENING_IMPORT_TEMPLATES,
  OpeningImportConflictError,
  OpeningImportStaleError,
  OpeningImportValidationError,
  createOpeningImportServices,
  type OpeningImportServices,
  type OpeningImportTemplateName,
} from "@bravos/opening-import";
import { createPostgresOpeningImportReportingReader, createPostgresOpeningImportStore } from "@bravos/opening-import/node";
import { createPostgresOpeningCatalogTransaction } from "@bravos/catalog/node";
import { createPostgresOpeningReceivingTransaction } from "@bravos/receiving/node";
import { createPostgresOpeningExpenseTransaction } from "@bravos/expenses/node";
import { createPostgresOpeningPricingTransaction } from "@bravos/pricing/node";
import { createPostgresOpeningStorefrontConfigTransaction } from "@bravos/storefront-config/node";
import { createPostgresOpeningOnlineOrderTransaction } from "@bravos/online-orders/node";
import {
  ReportingExportLimitError,
  ReportingValidationError,
  createReportingServices,
  type ReportingServices,
} from "@bravos/reporting";
import { createPostgresReportingReadUnitOfWork } from "@bravos/reporting/node";
import { createPostgresCatalogReportingReader } from "@bravos/catalog/node";
import { createPostgresReturnCorrectionReportingReader, createPostgresSaleCorrectionReportingReader } from "@bravos/corrections/node";
import { createPostgresExpenseReportingReader } from "@bravos/expenses/node";
import { createPostgresOnlineOrderReportingReader } from "@bravos/online-orders/node";
import { createPostgresPurchaseReportingReader } from "@bravos/receiving/node";
import { createPostgresReturnReportingFactsReader } from "@bravos/returns/node";
import { createPostgresPhysicalSaleReportingReader } from "@bravos/sales/node";
import {
  ReportExportValidationError,
  createReportExportServices,
  type ReportExportServices,
} from "@bravos/report-export";
import { createLazyReportRenderer } from "@bravos/report-export/node";
import { BackupInProgressError, BackupValidationError, createBackupServices, type BackupServices } from "@bravos/backup";
import {
  createBackupQueryable,
  createNodeBackupCrypto,
  createPostgresBackupUnitOfWork,
  decodeBackupArchive,
  type BackupQueryable,
} from "@bravos/backup/node";
import type { BackupReaderSet } from "@bravos/backup";
import {
  RestorePausedError,
  RestoreStaleError,
  RestoreValidationError,
  createRestoreServices,
  type RestoreServices,
} from "@bravos/restore";
import {
  createPostgresRestoreRuntimeReader,
  createPostgresRestoreStore,
  isRestorePausedDatabaseError,
} from "@bravos/restore/node";
import { createPostgresIdentityRestorePort } from "@bravos/identity/node";
import { createPostgresCatalogRestorePort } from "@bravos/catalog/node";
import { createPostgresInventoryRestorePort } from "@bravos/inventory/node";
import { createPostgresReceivingRestorePort } from "@bravos/receiving/node";
import { createPostgresExpensesRestorePort } from "@bravos/expenses/node";
import { createPostgresPricingRestorePort } from "@bravos/pricing/node";
import { createPostgresReturnsRestorePort } from "@bravos/returns/node";
import { createPostgresCorrectionsRestorePort } from "@bravos/corrections/node";
import { createPostgresOnlineOrdersRestorePort } from "@bravos/online-orders/node";
import { createPostgresStorefrontConfigRestorePort } from "@bravos/storefront-config/node";
import { createPostgresOpeningImportRestorePort } from "@bravos/opening-import/node";
import { createPostgresAnalyticsRestorePort } from "@bravos/analytics/node";
import { createPostgresIdentityBackupReader } from "@bravos/identity/node";
import { createPostgresCatalogBackupReader } from "@bravos/catalog/node";
import { createPostgresInventoryBackupReader } from "@bravos/inventory/node";
import { createPostgresReceivingBackupReader } from "@bravos/receiving/node";
import { createPostgresSalesBackupReader } from "@bravos/sales/node";
import { createPostgresExpensesBackupReader } from "@bravos/expenses/node";
import { createPostgresPricingBackupReader } from "@bravos/pricing/node";
import { createPostgresReturnsBackupReader } from "@bravos/returns/node";
import { createPostgresCorrectionsBackupReader } from "@bravos/corrections/node";
import { createPostgresOnlineOrdersBackupReader } from "@bravos/online-orders/node";
import { createPostgresStorefrontConfigBackupReader } from "@bravos/storefront-config/node";
import { createPostgresOpeningImportBackupReader } from "@bravos/opening-import/node";
import { createPostgresAnalyticsBackupReader } from "@bravos/analytics/node";
import type { AppConfig } from "./config.ts";

const ALLOWED_AUTH_ROUTES = new Set([
  "GET /api/auth/ok",
  "GET /api/auth/get-session",
  "POST /api/auth/sign-in/username",
  "POST /api/auth/sign-out",
]);

export type BuiltApp = {
  app: FastifyInstance;
  pool: Pool;
  services: ReturnType<typeof createIdentityServices>;
  catalog: CatalogServices;
  inventory: InventoryServices;
  receiving: ReceivingServices;
  pricing: PricingServices;
  sales: SalesServices;
  expenses: ExpenseServices;
  returns: ReturnServices;
  corrections: CorrectionServices;
  storefrontConfig: StorefrontConfigServices;
  onlineOrders: OnlineOrderServices;
  openingImport: OpeningImportServices;
  backup: BackupServices;
  restore: RestoreServices;
  analytics: AnalyticsServices;
  reporting: ReportingServices;
  reportExport: ReportExportServices;
  auth: ReturnType<typeof createBetterAuth>;
  identity: IdentityGateway;
  close: () => Promise<void>;
};

export async function buildApp(config: AppConfig): Promise<BuiltApp> {
  let productMediaDir = config.productMediaDir ?? ".local/product-media";
  let ownerRecoveryOutboxDir = config.ownerRecoveryOutboxDir;
  if (config.nodeEnv === "production") {
    if (config.ownerRecoveryAdapter !== "operator-file") {
      throw new Error(
        "Owner recovery is fail-closed in production until the explicit operator-file adapter is configured.",
      );
    }
    if (!config.ownerRecoveryOutboxDir) {
      throw new Error("BRAVOS_OWNER_RECOVERY_OUTBOX_DIR is required for the operator-file adapter.");
    }
    if (!config.productMediaDir) {
      throw new Error("BRAVOS_PRODUCT_MEDIA_DIR is required in production.");
    }
    const [recoveryCandidate, mediaCandidate] = await Promise.all([
      resolveOperatorRecoveryDirectory(config.ownerRecoveryOutboxDir),
      resolveExternalOperatorDirectory(config.productMediaDir, "Product media directory"),
    ]);
    if (operatorDirectoriesOverlap(recoveryCandidate, mediaCandidate)) {
      throw new Error("Recovery and product media must use separate, non-overlapping external directories.");
    }
    const [preparedRecovery, preparedMedia] = await Promise.all([
      prepareOperatorRecoveryDirectory(config.ownerRecoveryOutboxDir),
      prepareExternalOperatorDirectory(config.productMediaDir, "Product media directory"),
    ]);
    if (operatorDirectoriesOverlap(preparedRecovery, preparedMedia)) {
      throw new Error("Recovery and product media resolved to overlapping external directories.");
    }
    ownerRecoveryOutboxDir = preparedRecovery;
    productMediaDir = preparedMedia;
  } else if (config.ownerRecoveryAdapter === "operator-file" && config.ownerRecoveryOutboxDir) {
    ownerRecoveryOutboxDir = await prepareOperatorRecoveryDirectory(config.ownerRecoveryOutboxDir);
  }
  const recoveryOutbox = createOwnerRecoveryOutbox({
    nodeEnv: config.nodeEnv,
    adapter: config.ownerRecoveryAdapter,
    directory: ownerRecoveryOutboxDir,
  });

  const pool = new Pool({
    connectionString: config.databaseUrl,
    options: "-c client_encoding=UTF8",
    ...(config.databasePoolMax ? { max: config.databasePoolMax } : {}),
  });
  pool.on("error", (error) => {
    console.error(sanitizePoolError(error));
  });

  let app: FastifyInstance | undefined;
  try {
    await applyMigrations(pool);
    const auth = createBetterAuth(pool, {
      baseURL: config.authBaseUrl,
      secret: config.authSecret,
      trustedOrigins: config.trustedOrigins,
      secureCookies: config.secureCookies,
    });
    await awaitAuthReady(auth);
    const identity = createBetterAuthIdentityProvider(auth, pool);
    const directory = createPostgresStaffDirectory(pool);
    const services = createIdentityServices({
      identity,
      directory,
      recoveryOutbox,
    });
    const catalogStore = createPostgresCatalogStore(pool);
    const productMedia = createLocalProductMediaStorage(productMediaDir);
    const inventoryStore = createPostgresInventoryStore(pool);
    const actors = {
      getStaff: (staffId: string) => directory.getStaff(staffId),
      getSessionBranch: (sessionId: string) => directory.getSessionBranch(sessionId),
      listBranches: () => directory.listBranches(),
    };
    const catalog = createCatalogServices({
      store: catalogStore,
      actors,
      availability: createInventoryAvailabilityReader(inventoryStore),
      references: {
        async idsWithInventory(ids) {
          const [stocked, sold] = await Promise.all([
            inventoryStore.referencedVariantIds(ids),
            createPostgresSaleStore(pool).referencedVariantIds(ids),
          ]);
          return [...new Set([...stocked, ...sold])];
        },
      },
      media: productMedia,
    });
    const inventory = createInventoryServices({
      store: inventoryStore,
      actors,
      variants: {
        getVariants: (ids) => catalogStore.getVariants(ids),
        listIds: () => catalogStore.listVariantIds(),
      },
      coordination: createPostgresStockCoordinationStore(
        pool,
        createInventoryTransaction,
        createPostgresStockReconciliationSales,
        (queryable) => {
          const returnFacts = createPostgresStockReconciliationReturnFacts(queryable);
          const correctionFacts = createPostgresStockReconciliationCorrectionFacts(queryable);
          return {
            async hasDownstreamFacts(saleId, saleLineIds) {
              if (await returnFacts.hasPostedForSourceLines(saleId, saleLineIds)) return true;
              if (await correctionFacts.hasForSale(saleId)) return true;
              return correctionFacts.hasForReturns(await returnFacts.listIdsForSale(saleId));
            },
          };
        },
      ),
    });
    const receiving = createReceivingServices({
      actors,
      variants: { getVariants: (ids) => catalogStore.getVariants(ids) },
      inventory: inventoryStore,
      receipts: createPostgresReceiptStore(pool),
      corrections: createPostgresReceiptCorrectionStore(pool),
      uow: createPostgresReceivingUnitOfWork(pool, createInventoryTransaction),
    });
    const pricing = createPricingServices({
      actors: { getStaff: (staffId) => directory.getStaff(staffId) },
      offers: createPostgresAutomaticOfferStore(pool),
      coupons: createPostgresCouponStore(pool),
    });
    const saleStore = createPostgresSaleStore(pool);
    const sales = createSalesServices({
      actors: {
        getStaff: (staffId) => directory.getStaff(staffId),
        getSessionBranch: (sessionId) => directory.getSessionBranch(sessionId),
        listBranches: async () => {
          const rows = await directory.listBranches();
          return rows.map((row) => ({ id: row.id, code: row.code, nameAr: row.nameAr }));
        },
      },
      prices: { getListedPrices: (ids) => catalogStore.getListedPrices(ids) },
      pricingQuote: createPostgresPricingQuoteReader(pool, (client) => ({
        prices: createPostgresListedPriceReader(client),
        automaticPricing: createPostgresAutomaticPricingReader(client),
      })),
      sales: saleStore,
      snapshots: createPostgresPriceSnapshotStore(pool),
      cashierCatalog: {
        listCashierProducts: (auth) => catalog.listCashierCatalog(auth),
      },
      uow: createPostgresSalesUnitOfWork(
        pool,
        createInventoryTransaction,
        createPostgresCouponUsageTransaction,
        createPostgresRestoreRuntimeReader,
      ),
      allocations: { listAllocations: (operationId) => inventoryStore.listAllocations(operationId) },
      deferredCompletions: createPostgresDeferredCompletedSaleStore(pool, createPostgresRestoreRuntimeReader),
    });
    const expenses = createExpenseServices({
      actors,
      expenses: createPostgresExpenseRepository(pool),
    });
    const onlineOrderStore = createPostgresOnlineOrderStore(pool);
    const returns = createReturnServices({
      actors: {
        getStaff: (staffId) => directory.getStaff(staffId),
        listBranches: async () => {
          const rows = await directory.listBranches();
          return rows.map((row) => ({ id: row.id, code: row.code, nameAr: row.nameAr }));
        },
      },
      variants: { getVariants: (ids) => catalogStore.getVariants(ids) },
      returns: createPostgresReturnsStore(pool, createPostgresPhysicalSaleSourceCandidateReader(pool)),
      onlineSources: onlineOrderStore,
      inventoryReads: inventoryStore,
      corrections: createPostgresReturnCorrectionStateReader(pool),
      replacementSales: {
        getById: (id) => saleStore.getById(id),
        listAllocations: (operationId) => inventoryStore.listAllocations(operationId),
      },
      replacementPricing: createExchangeReplacementPricing(createPostgresPricingQuoteReader(pool, (client) => ({
        prices: createPostgresListedPriceReader(client),
        automaticPricing: createPostgresAutomaticPricingReader(client),
      }))),
      uow: createPostgresReturnsUnitOfWork(
        pool,
        (client) => createInventoryTransaction(client, config.businessClock ? { now: config.businessClock } : undefined),
        createPostgresOnlineOrderStore,
        createPostgresReturnCorrectionStateReader,
        (client, inventoryTransaction) => createExchangeReplacementSaleWriter({
          sales: createPostgresSaleStore(client),
          inventory: inventoryTransaction,
          restore: createPostgresRestoreRuntimeReader(client),
        }),
        createPostgresPhysicalSaleSourceCandidateReader,
      ),
      clock: { now: config.businessClock ?? (() => new Date()) },
    });
    const corrections = createCorrectionServices({
      actors: { getStaff: (staffId) => directory.getStaff(staffId) },
      corrections: createPostgresCorrectionsRepository(pool, createInventoryTransaction, createPostgresOnlineOrderStore),
      clock: { now: config.businessClock ?? (() => new Date()) },
    });
    const storefrontConfig = createStorefrontConfigServices({
      actors,
      contacts: createPostgresStorefrontContactsStore(pool),
    });
    const onlineOrders = createOnlineOrderServices({
      actors,
      store: onlineOrderStore,
      uow: createPostgresOnlineOrderUnitOfWork(pool, (client) => ({
        catalog: createPostgresCheckoutCatalogReader(client),
        inventory: createInventoryTransaction(client),
        pricing: createPostgresAutomaticPricingReader(client),
        couponUsage: createPostgresCouponUsageTransaction(client),
      })),
      clock: { now: config.businessClock ?? (() => new Date()) },
    });
    const openingImport = createOpeningImportServices({
      actors,
      store: createPostgresOpeningImportStore(pool, (client) => ({
        catalog: createPostgresOpeningCatalogTransaction(client),
        inventory: createInventoryTransaction(client),
        receiving: createPostgresOpeningReceivingTransaction(client),
        expenses: createPostgresOpeningExpenseTransaction(client),
        pricing: createPostgresOpeningPricingTransaction(client),
        storefront: createPostgresOpeningStorefrontConfigTransaction(client),
        orders: createPostgresOpeningOnlineOrderTransaction(client),
      })),
      clock: { now: config.businessClock ?? (() => new Date()) },
    });
    const backupCrypto = createNodeBackupCrypto();
    const backup = createBackupServices({
      actors,
      crypto: backupCrypto,
      unitOfWork: createPostgresBackupUnitOfWork(pool, createBackupReaders),
    });
    const restore = createRestoreServices({
      actors,
      archive: {
        decode: decodeBackupArchive,
        decodeBase64: (value) => Buffer.from(value, "base64"),
        sha256: (value) => backupCrypto.sha256(value),
      },
      backup,
      store: createPostgresRestoreStore({
        pool,
        databaseUrl: config.databaseUrl,
        factories: {
          features: (queryable) => ({
            identity: createPostgresIdentityRestorePort(queryable),
            catalog: createPostgresCatalogRestorePort(queryable),
            sales: createPostgresSalesRestorePort(queryable),
            inventory: createPostgresInventoryRestorePort(queryable),
            receiving: createPostgresReceivingRestorePort(queryable),
            pricing: createPostgresPricingRestorePort(queryable),
            expenses: createPostgresExpensesRestorePort(queryable),
            onlineOrders: createPostgresOnlineOrdersRestorePort(queryable),
            storefrontConfiguration: createPostgresStorefrontConfigRestorePort(queryable),
            returns: createPostgresReturnsRestorePort(queryable),
            corrections: createPostgresCorrectionsRestorePort(queryable),
            openingImport: createPostgresOpeningImportRestorePort(queryable),
            analytics: createPostgresAnalyticsRestorePort(queryable),
          }),
          liveReaders: (client: PoolClient) => createBackupReaders(createBackupQueryable(client)),
          snapshot: (stagePool) => createPostgresBackupUnitOfWork(stagePool, createBackupReaders),
          migrate: (stagePool) => applyMigrations(stagePool),
        },
      }),
    });
    const analytics = createAnalyticsServices({
      actors: { getStaff: (staffId) => directory.getStaff(staffId) },
      catalog: { getPublicProduct: (productId) => catalog.getPublicProduct(productId) },
      orders: createPostgresOnlineOrderReportingReader(pool),
      store: createPostgresAnalyticsStore(pool),
      clock: { now: config.businessClock ?? (() => new Date()) },
    });
    const reporting = createReportingServices({
      actors: {
        getStaff: (staffId) => directory.getStaff(staffId),
        listBranches: () => directory.listBranches(),
        listStaff: () => directory.listStaff(),
      },
      uow: createPostgresReportingReadUnitOfWork(pool, (client) => ({
        sales: createPostgresPhysicalSaleReportingReader(client),
        saleCorrections: createPostgresSaleCorrectionReportingReader(client),
        returnCorrections: createPostgresReturnCorrectionReportingReader(client),
        inventory: createPostgresInventoryStore(client),
        orders: createPostgresOnlineOrderReportingReader(client),
        returns: createPostgresReturnReportingFactsReader(client),
        purchases: createPostgresPurchaseReportingReader(client),
        openingImports: createPostgresOpeningImportReportingReader(client),
        expenses: createPostgresExpenseReportingReader(client),
        catalog: createPostgresCatalogReportingReader(client),
      })),
      clock: { now: config.businessClock ?? (() => new Date()) },
    });
    const reportExport = createReportExportServices({
      reports: reporting,
      renderer: createLazyReportRenderer(),
    });

    const instance = Fastify({ logger: false });
    app = instance;
    await registerRoutes(instance, config, auth, identity, services, catalog, inventory, receiving, pricing, sales, expenses, returns, corrections, storefrontConfig, onlineOrders, openingImport, backup, restore, analytics, reporting, reportExport);

    return {
      app: instance,
      pool,
      services,
      catalog,
      inventory,
      receiving,
      pricing,
      sales,
      expenses,
      returns,
      corrections,
      storefrontConfig,
      onlineOrders,
      openingImport,
      backup,
      restore,
      analytics,
      reporting,
      reportExport,
      auth,
      identity,
      async close() {
        try {
          await instance.close();
        } finally {
          await pool.end();
        }
      },
    };
  } catch (error) {
    if (app) {
      await app.close().catch((closeError) => {
        console.error(sanitizePoolError(closeError));
      });
    }
    await pool.end().catch((closeError) => {
      console.error(sanitizePoolError(closeError));
    });
    throw error;
  }
}

function createBackupReaders(queryable: BackupQueryable): BackupReaderSet {
  return {
    identity: createPostgresIdentityBackupReader(queryable),
    catalog: createPostgresCatalogBackupReader(queryable),
    inventory: createPostgresInventoryBackupReader(queryable),
    receiving: createPostgresReceivingBackupReader(queryable),
    sales: createPostgresSalesBackupReader(queryable),
    expenses: createPostgresExpensesBackupReader(queryable),
    pricing: createPostgresPricingBackupReader(queryable),
    returns: createPostgresReturnsBackupReader(queryable),
    corrections: createPostgresCorrectionsBackupReader(queryable),
    onlineOrders: createPostgresOnlineOrdersBackupReader(queryable),
    storefrontConfiguration: createPostgresStorefrontConfigBackupReader(queryable),
    openingImport: createPostgresOpeningImportBackupReader(queryable),
    analytics: createPostgresAnalyticsBackupReader(queryable),
    restore: createPostgresRestoreRuntimeReader(queryable),
  };
}

async function registerRoutes(
  app: FastifyInstance,
  config: AppConfig,
  auth: ReturnType<typeof createBetterAuth>,
  identity: IdentityGateway,
  services: ReturnType<typeof createIdentityServices>,
  catalog: CatalogServices,
  inventory: InventoryServices,
  receiving: ReceivingServices,
  pricing: PricingServices,
  sales: SalesServices,
  expenses: ExpenseServices,
  returns: ReturnServices,
  corrections: CorrectionServices,
  storefrontConfig: StorefrontConfigServices,
  onlineOrders: OnlineOrderServices,
  openingImport: OpeningImportServices,
  backup: BackupServices,
  restore: RestoreServices,
  analytics: AnalyticsServices,
  reporting: ReportingServices,
  reportExport: ReportExportServices,
) {
  app.addHook("onRequest", async (request, reply) => {
    if (isPrivilegedPath(request.url) && !isTrustedInternalOrigin(request, config)) {
      return reply.status(403).send(errorBody("ORIGIN_DENIED", "مصدر الطلب غير موثوق."));
    }
  });

  await app.register(
    async (instance) => {
      instance.route({
        method: ["GET", "POST"],
        url: "/*",
        async handler(request, reply) {
          const pathname = request.url.split("?")[0] ?? request.url;
          const key = `${request.method} ${pathname.startsWith("/api/auth") ? pathname : `/api/auth${pathname}`}`;
          if (!ALLOWED_AUTH_ROUTES.has(key)) {
            return reply.status(404).send(errorBody("NOT_FOUND", "المسار غير متاح."));
          }
          return forwardAuth(auth, request, reply);
        },
      });
    },
    { prefix: "/api/auth" },
  );

  app.get("/api/public/health", async () => ({
    ok: true,
    application: "bravos-public",
  }));

  const publicOrderingEnabled = config.publicOrderingEnabled ?? config.nodeEnv !== "production";
  app.get("/api/public/runtime", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return { publicOrderingEnabled };
  });

  app.post("/api/public/analytics/events", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return handle(reply, async () => {
      const result = await analytics.recordPublicEvent(request.body);
      reply.status(result.created ? 201 : 200);
      return result.event;
    });
  });

  app.get("/api/public/catalog/products", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return handle(reply, async () => catalog.listPublicProducts());
  });

  app.get("/api/public/storefront/catalog", async (request, reply) => {
    const params = request.query as { categoryId?: string | string[] };
    reply.header("cache-control", "no-store");
    return handle(reply, async () => catalog.browsePublicProducts({
      categoryId: Array.isArray(params.categoryId) ? params.categoryId[0] : params.categoryId,
    }));
  });

  app.get("/api/public/storefront/contacts", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return handle(reply, async () => storefrontConfig.publicContacts());
  });

  app.get("/api/public/checkout/delivery-areas", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return handle(reply, async () => onlineOrders.publicAreas());
  });

  app.post("/api/public/checkout/quote", async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (!publicOrderingEnabled) return publicOrderingDisabled(reply);
    return handle(reply, async () => onlineOrders.quote(request.body));
  });

  app.post("/api/public/checkout/orders", async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (!publicOrderingEnabled) {
      return handle(reply, async () => {
        const accepted = await onlineOrders.replayAcceptedSubmission(request.body);
        return accepted ?? publicOrderingDisabled(reply);
      });
    }
    return handle(reply, async () => {
      const result = await onlineOrders.submit(request.body);
      reply.status(result.created ? 201 : 200);
      return result.result;
    });
  });

  app.get("/api/public/catalog/products/:productId", async (request, reply) => {
    const params = request.params as { productId: string };
    reply.header("cache-control", "no-store");
    return handle(reply, async () => catalog.getPublicProduct(params.productId));
  });

  app.get("/api/public/catalog/media/*", async (request, reply) => {
    const params = request.params as { "*": string };
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", "default-src 'none'; sandbox");
    return handle(reply, async () => {
      const media = await catalog.getPublicMedia(params["*"]);
      reply.header("content-type", media.contentType);
      return reply.send(Buffer.from(media.bytes));
    });
  });

  app.get("/api/internal/workspace", async (request, reply) => {
    return handle(reply, async () => services.workspace(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/analytics", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return handle(reply, async () => analytics.summary(await verifiedAuth(identity, request), request.query));
  });

  app.get("/api/internal/reports/management", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return handle(reply, async () => reporting.getManagementReport(await verifiedAuth(identity, request), request.query));
  });

  app.get("/api/internal/reports/management/export", async (request, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    return handle(reply, async () => {
      const file = await reportExport.management(await verifiedAuth(identity, request), request.query);
      reply.header("content-type", file.contentType);
      reply.header("content-disposition", `attachment; filename="${file.fileName}"`);
      return reply.send(Buffer.from(file.bytes));
    });
  });

  app.get("/api/internal/backups/readiness", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return handle(reply, async () => backup.readiness(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/backups", { bodyLimit: 16_384 }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    return handle(reply, async () => {
      const result = await backup.create(await verifiedAuth(identity, request), request.body);
      reply.status(201);
      reply.header("content-type", "application/vnd.bravos.backup");
      reply.header("content-disposition", `attachment; filename="${result.fileName}"`);
      reply.header("x-bravos-backup-id", result.manifest.backupId);
      reply.header("x-bravos-backup-format-version", String(result.manifest.formatVersion));
      reply.header("x-bravos-backup-created-at", result.manifest.createdAt);
      reply.header("x-bravos-backup-schema-version", result.manifest.schemaVersion);
      reply.header("x-bravos-backup-total-record-count", String(result.manifest.totalRecordCount));
      reply.header("x-bravos-backup-section-counts", Buffer.from(JSON.stringify(result.sectionCounts), "utf8").toString("base64url"));
      reply.header("x-bravos-backup-known-unsynchronized-till-count", String(result.manifest.knownUnsynchronizedTills.length));
      reply.header("x-bravos-backup-includes-unsent-browser-records", "false");
      reply.header("x-bravos-backup-includes-image-binaries", "false");
      reply.header("x-bravos-backup-sha256", result.archiveSha256);
      return reply.send(Buffer.from(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength));
    });
  });

  app.get("/api/internal/restore/state", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return handle(reply, async () => restore.state(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/restore/pause", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return handle(reply, async () => restore.pause(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/restore/previews", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return handle(reply, async () => restore.list(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/restore/previews/:previewId", async (request, reply) => {
    const params = request.params as { previewId: string };
    reply.header("cache-control", "no-store");
    return handle(reply, async () => restore.get(await verifiedAuth(identity, request), params.previewId));
  });

  // The encrypted archive travels as base64 JSON; 270 MiB covers the 192 MiB archive limit.
  app.post("/api/internal/restore/previews", {
    bodyLimit: 270 * 1024 * 1024,
    // Only a signed-in manager may send the large archive body; it is refused before it is read.
    onRequest: async (request, reply) => {
      try {
        await restore.authorizeManager(await verifiedAuth(identity, request));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    return handle(reply, async () => {
      const result = await restore.createPreview(await verifiedAuth(identity, request), request.body);
      reply.status(result.created ? 201 : 200);
      return result.value;
    });
  });

  app.get("/api/internal/restore/previews/:previewId/pre-restore-backup", async (request, reply) => {
    const params = request.params as { previewId: string };
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    return handle(reply, async () => {
      const result = await restore.downloadPreRestoreBackup(await verifiedAuth(identity, request), params.previewId);
      reply.header("content-type", "application/vnd.bravos.backup");
      reply.header("content-disposition", `attachment; filename="${result.fileName}"`);
      reply.header("x-bravos-backup-sha256", result.archiveSha256);
      return reply.send(Buffer.from(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength));
    });
  });

  app.post("/api/internal/restore/previews/:previewId/pre-restore-backup/acknowledgement", async (request, reply) => {
    const params = request.params as { previewId: string };
    reply.header("cache-control", "no-store");
    return handle(reply, async () => restore.acknowledgePreRestoreBackup(
      await verifiedAuth(identity, request), params.previewId, request.body,
    ));
  });

  app.post("/api/internal/restore/previews/:previewId/acknowledgements", async (request, reply) => {
    const params = request.params as { previewId: string };
    reply.header("cache-control", "no-store");
    return handle(reply, async () => restore.acknowledge(await verifiedAuth(identity, request), params.previewId, request.body));
  });

  app.post("/api/internal/restore/previews/:previewId/cancel", async (request, reply) => {
    const params = request.params as { previewId: string };
    reply.header("cache-control", "no-store");
    return handle(reply, async () => restore.cancel(await verifiedAuth(identity, request), params.previewId));
  });

  app.post("/api/internal/restore/previews/:previewId/activate", async (request, reply) => {
    const params = request.params as { previewId: string };
    reply.header("cache-control", "no-store");
    return handle(reply, async () => {
      const result = await restore.activate(await verifiedAuth(identity, request), params.previewId, request.body);
      reply.status(result.created ? 201 : 200);
      return result.value;
    });
  });

  app.get("/api/internal/opening-import/templates/:fileName", async (request, reply) => {
    const params = request.params as { fileName: string };
    reply.header("cache-control", "no-store");
    return handle(reply, async () => {
      await openingImport.authorizeTemplate(await verifiedAuth(identity, request));
      if (!(params.fileName in OPENING_IMPORT_TEMPLATES)) throw new NotFoundError("قالب الاستيراد غير موجود.");
      const fileName = params.fileName as OpeningImportTemplateName;
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="${fileName}"`);
      return `\uFEFF${OPENING_IMPORT_TEMPLATES[fileName]}`;
    });
  });

  app.post("/api/internal/opening-import/previews", { bodyLimit: 3_300_000 }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    return handle(reply, async () => {
      const result = await openingImport.preview(await verifiedAuth(identity, request), request.body);
      reply.status(result.created ? 201 : 200);
      return result.value;
    });
  });

  app.get("/api/internal/opening-import/previews/:previewId", async (request, reply) => {
    const params = request.params as { previewId: string };
    reply.header("cache-control", "no-store");
    return handle(reply, async () => openingImport.get(await verifiedAuth(identity, request), params.previewId));
  });

  app.post("/api/internal/opening-import/previews/:previewId/accept", async (request, reply) => {
    const params = request.params as { previewId: string };
    reply.header("cache-control", "no-store");
    return handle(reply, async () => {
      const result = await openingImport.accept(await verifiedAuth(identity, request), params.previewId, request.body);
      reply.status(result.created ? 201 : 200);
      return result.value;
    });
  });

  app.get("/api/internal/storefront/contacts", async (request, reply) => {
    return handle(reply, async () => storefrontConfig.managerContacts(await verifiedAuth(identity, request)));
  });

  app.patch("/api/internal/storefront/contacts", async (request, reply) => {
    return handle(reply, async () => storefrontConfig.updateContacts(await verifiedAuth(identity, request), request.body));
  });

  app.get("/api/internal/delivery-areas", async (request, reply) => {
    return handle(reply, async () => onlineOrders.listAreas(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/delivery-areas", async (request, reply) => {
    return handle(reply, async () => {
      const area = await onlineOrders.createArea(await verifiedAuth(identity, request), request.body);
      reply.status(201);
      return area;
    });
  });

  app.put("/api/internal/delivery-areas/:areaId", async (request, reply) => {
    const params = request.params as { areaId: string };
    return handle(reply, async () => onlineOrders.updateArea(await verifiedAuth(identity, request), params.areaId, request.body));
  });

  app.get("/api/internal/online-orders", async (request, reply) => {
    return handle(reply, async () => onlineOrders.listOrders(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/completed-online-orders", async (request, reply) => {
    return handle(reply, async () => onlineOrders.listCompletedOrders(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/online-orders/:orderId", async (request, reply) => {
    const params = request.params as { orderId: string };
    return handle(reply, async () => onlineOrders.getOrder(await verifiedAuth(identity, request), params.orderId));
  });

  app.post("/api/internal/online-orders/:orderId/agreement-quotes", async (request, reply) => {
    const params = request.params as { orderId: string };
    return handle(reply, async () => {
      const quote = await onlineOrders.createAgreementQuote(await verifiedAuth(identity, request), params.orderId, request.body);
      reply.status(201);
      return quote;
    });
  });

  app.post("/api/internal/online-orders/:orderId/agreed-revisions", async (request, reply) => {
    const params = request.params as { orderId: string };
    return handle(reply, async () => {
      const result = await onlineOrders.agreeRevision(await verifiedAuth(identity, request), params.orderId, request.body);
      reply.status(result.created ? 201 : 200);
      return result.result;
    });
  });

  app.post("/api/internal/online-orders/:orderId/contact-attempts", async (request, reply) => {
    const params = request.params as { orderId: string };
    return handle(reply, async () => {
      const result = await onlineOrders.recordContactAttempt(await verifiedAuth(identity, request), params.orderId, request.body);
      reply.status(result.created ? 201 : 200);
      return result.result;
    });
  });

  app.post("/api/internal/online-orders/:orderId/confirm", async (request, reply) => {
    const params = request.params as { orderId: string };
    return handle(reply, async () => {
      const result = await onlineOrders.confirm(await verifiedAuth(identity, request), params.orderId, request.body);
      reply.status(result.created ? 201 : 200);
      return result.result;
    });
  });

  app.post("/api/internal/online-orders/:orderId/cancel-unreachable", async (request, reply) => {
    const params = request.params as { orderId: string };
    return handle(reply, async () => {
      const result = await onlineOrders.cancelUnreachable(await verifiedAuth(identity, request), params.orderId, request.body);
      reply.status(result.created ? 201 : 200);
      return result.result;
    });
  });

  app.post("/api/internal/online-orders/:orderId/ship", async (request, reply) => {
    const params = request.params as { orderId: string };
    return handle(reply, async () => {
      const result = await onlineOrders.ship(await verifiedAuth(identity, request), params.orderId, request.body);
      reply.status(result.created ? 201 : 200);
      return result;
    });
  });

  app.post("/api/internal/online-orders/:orderId/deliver", async (request, reply) => {
    const params = request.params as { orderId: string };
    return handle(reply, async () => {
      const result = await onlineOrders.deliver(await verifiedAuth(identity, request), params.orderId, request.body);
      reply.status(result.created ? 201 : 200);
      return result;
    });
  });

  app.post("/api/internal/online-orders/:orderId/delivery-failure", async (request, reply) => {
    const params = request.params as { orderId: string };
    return handle(reply, async () => {
      const result = await onlineOrders.markDeliveryFailed(await verifiedAuth(identity, request), params.orderId, request.body);
      reply.status(result.created ? 201 : 200);
      return result;
    });
  });

  app.post("/api/internal/online-orders/:orderId/cancel-before-shipment", async (request, reply) => {
    const params = request.params as { orderId: string };
    return handle(reply, async () => {
      const result = await onlineOrders.cancelBeforeShipment(await verifiedAuth(identity, request), params.orderId, request.body);
      reply.status(result.created ? 201 : 200);
      return result;
    });
  });

  app.post("/api/internal/online-orders/:orderId/failed-return-inspections", async (request, reply) => {
    const params = request.params as { orderId: string };
    return handle(reply, async () => {
      const result = await onlineOrders.draftFailedReturnInspection(await verifiedAuth(identity, request), params.orderId, request.body);
      reply.status(result.created ? 201 : 200);
      return result;
    });
  });

  app.post("/api/internal/online-orders/:orderId/failed-return-inspections/:inspectionId/post", async (request, reply) => {
    const params = request.params as { orderId: string; inspectionId: string };
    return handle(reply, async () => {
      const result = await onlineOrders.postFailedReturnInspection(
        await verifiedAuth(identity, request), params.orderId, params.inspectionId, request.body,
      );
      reply.status(result.created ? 201 : 200);
      return result;
    });
  });

  app.post("/api/internal/online-orders/:orderId/failed-return-inspections/:inspectionId/abandon", async (request, reply) => {
    const params = request.params as { orderId: string; inspectionId: string };
    return handle(reply, async () => {
      const result = await onlineOrders.abandonFailedReturnInspection(
        await verifiedAuth(identity, request), params.orderId, params.inspectionId, request.body,
      );
      reply.status(result.created ? 201 : 200);
      return result;
    });
  });

  app.post("/api/internal/online-orders/:orderId/close-failed-delivery", async (request, reply) => {
    const params = request.params as { orderId: string };
    return handle(reply, async () => {
      const result = await onlineOrders.closeFailedDelivery(await verifiedAuth(identity, request), params.orderId, request.body);
      reply.status(result.created ? 201 : 200);
      return result;
    });
  });

  app.get("/api/internal/online-order-settings", async (request, reply) => {
    return handle(reply, async () => onlineOrders.getSettings(await verifiedAuth(identity, request)));
  });

  app.put("/api/internal/online-order-settings", async (request, reply) => {
    return handle(reply, async () => onlineOrders.updateSettings(await verifiedAuth(identity, request), request.body));
  });

  app.get("/api/internal/branches", async (request, reply) => {
    return handle(reply, async () => {
      const workspace = await services.workspace(await verifiedAuth(identity, request));
      return workspace.authorizedBranches;
    });
  });

  app.post("/api/internal/active-branch", async (request, reply) => {
    const body = asObject(request.body);
    return handle(reply, async () =>
      services.selectActiveBranch(await verifiedAuth(identity, request), String(body.branchId ?? "")),
    );
  });

  app.get("/api/internal/staff", async (request, reply) => {
    return handle(reply, async () => services.listStaff(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/staff", async (request, reply) => {
    const body = asObject(request.body);
    return handle(reply, async () => {
      const created = await services.provisionStaff(await verifiedAuth(identity, request), {
        loginName: String(body.loginName ?? ""),
        displayName: String(body.displayName ?? ""),
        password: String(body.password ?? ""),
        role: "employee",
        grants: body.grants,
      });
      reply.status(201);
      return created;
    });
  });

  app.post("/api/internal/staff/:staffId/reset-password", async (request, reply) => {
    const body = asObject(request.body);
    const params = request.params as { staffId: string };
    return handle(reply, async () =>
      services.resetPassword(
        await verifiedAuth(identity, request),
        params.staffId,
        String(body.password ?? ""),
      ),
    );
  });

  app.post("/api/internal/staff/:staffId/disable", async (request, reply) => {
    const params = request.params as { staffId: string };
    return handle(reply, async () =>
      services.disableStaff(await verifiedAuth(identity, request), params.staffId),
    );
  });

  app.post("/api/internal/staff/:staffId/grants", async (request, reply) => {
    const body = asObject(request.body);
    const params = request.params as { staffId: string };
    return handle(reply, async () =>
      services.setGrants(await verifiedAuth(identity, request), params.staffId, body.grants),
    );
  });

  app.post("/api/internal/owner-recovery/request", async (request, reply) => {
    const body = asObject(request.body);
    return handle(reply, async () => {
      try {
        await services.requestOwnerRecovery(String(body.loginName ?? ""));
      } catch (error) {
        if (!(error instanceof IdentityValidationError)) {
          throw error;
        }
      }
      return { accepted: true };
    });
  });

  app.post("/api/internal/owner-recovery/complete", async (request, reply) => {
    const body = asObject(request.body);
    return handle(reply, async () => {
      await services.completeOwnerRecovery(String(body.token ?? ""), String(body.password ?? ""));
      return { recovered: true };
    });
  });

  app.get("/api/internal/catalog/categories", async (request, reply) => {
    return handle(reply, async () => catalog.listCategories(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/catalog/categories", async (request, reply) => {
    return handle(reply, async () => {
      const created = await catalog.createCategory(await verifiedAuth(identity, request), request.body);
      reply.status(201);
      return created;
    });
  });

  app.patch("/api/internal/catalog/categories/:categoryId", async (request, reply) => {
    const params = request.params as { categoryId: string };
    return handle(reply, async () =>
      catalog.updateCategory(await verifiedAuth(identity, request), params.categoryId, request.body),
    );
  });

  app.get("/api/internal/catalog/sizes", async (request, reply) => {
    return handle(reply, async () => catalog.listSizes(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/catalog/sizes", async (request, reply) => {
    return handle(reply, async () => {
      const created = await catalog.createSize(await verifiedAuth(identity, request), request.body);
      reply.status(201);
      return created;
    });
  });

  app.patch("/api/internal/catalog/sizes/:sizeId", async (request, reply) => {
    const params = request.params as { sizeId: string };
    return handle(reply, async () =>
      catalog.updateSize(await verifiedAuth(identity, request), params.sizeId, request.body),
    );
  });

  app.get("/api/internal/catalog/colors", async (request, reply) => {
    return handle(reply, async () => catalog.listColors(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/catalog/colors", async (request, reply) => {
    return handle(reply, async () => {
      const created = await catalog.createColor(await verifiedAuth(identity, request), request.body);
      reply.status(201);
      return created;
    });
  });

  app.patch("/api/internal/catalog/colors/:colorId", async (request, reply) => {
    const params = request.params as { colorId: string };
    return handle(reply, async () =>
      catalog.updateColor(await verifiedAuth(identity, request), params.colorId, request.body),
    );
  });

  app.get("/api/internal/catalog/products", async (request, reply) => {
    return handle(reply, async () => catalog.listProducts(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/catalog/products", async (request, reply) => {
    return handle(reply, async () => {
      const created = await catalog.createProduct(await verifiedAuth(identity, request), request.body);
      reply.status(201);
      return created;
    });
  });

  app.post(
    "/api/internal/catalog/media",
    { bodyLimit: 7_100_000 },
    async (request, reply) => {
      return handle(reply, async () => {
        const body = asObject(request.body);
        const uploaded = await catalog.uploadProductImage(await verifiedAuth(identity, request), {
          fileName: body.fileName,
          contentType: body.contentType,
          bytes: decodeBase64(body.base64),
        });
        reply.status(201);
        return uploaded;
      });
    },
  );

  app.get("/api/internal/catalog/media/*", async (request, reply) => {
    const params = request.params as { "*": string };
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", "default-src 'none'; sandbox");
    return handle(reply, async () => {
      const media = await catalog.getManagerMedia(await verifiedAuth(identity, request), params["*"]);
      reply.header("content-type", media.contentType);
      return reply.send(Buffer.from(media.bytes));
    });
  });

  app.get("/api/internal/catalog/products/:productId", async (request, reply) => {
    const params = request.params as { productId: string };
    return handle(reply, async () =>
      catalog.getProduct(await verifiedAuth(identity, request), params.productId),
    );
  });

  app.patch("/api/internal/catalog/products/:productId", async (request, reply) => {
    const params = request.params as { productId: string };
    return handle(reply, async () =>
      catalog.updateProduct(await verifiedAuth(identity, request), params.productId, request.body),
    );
  });

  app.get("/api/internal/catalog/lookup", async (request, reply) => {
    const query = request.query as { code?: string | string[] };
    const code = Array.isArray(query.code) ? query.code[0] : query.code;
    return handle(reply, async () => catalog.lookupByCode(await verifiedAuth(identity, request), code));
  });

  app.get("/api/internal/catalog/pos-snapshot", async (request, reply) => {
    return handle(reply, async () => catalog.listCashierCatalog(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/pricing/offers", async (request, reply) => {
    return handle(reply, async () => pricing.list(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/pricing/offers", async (request, reply) => {
    return handle(reply, async () => {
      const offer = await pricing.create(await verifiedAuth(identity, request), request.body);
      reply.status(201);
      return offer;
    });
  });

  app.get("/api/internal/pricing/offers/:offerId", async (request, reply) => {
    const params = request.params as { offerId: string };
    return handle(reply, async () => pricing.get(await verifiedAuth(identity, request), params.offerId));
  });

  app.put("/api/internal/pricing/offers/:offerId", async (request, reply) => {
    const params = request.params as { offerId: string };
    return handle(reply, async () => pricing.update(await verifiedAuth(identity, request), params.offerId, request.body));
  });

  app.get("/api/internal/pricing/coupons", async (request, reply) => {
    return handle(reply, async () => pricing.listCoupons(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/pricing/coupons", async (request, reply) => {
    return handle(reply, async () => {
      const coupon = await pricing.createCoupon(await verifiedAuth(identity, request), request.body);
      reply.status(201);
      return coupon;
    });
  });

  app.get("/api/internal/pricing/coupons/:couponId", async (request, reply) => {
    const params = request.params as { couponId: string };
    return handle(reply, async () => pricing.getCoupon(await verifiedAuth(identity, request), params.couponId));
  });

  app.put("/api/internal/pricing/coupons/:couponId", async (request, reply) => {
    const params = request.params as { couponId: string };
    return handle(reply, async () => pricing.updateCoupon(await verifiedAuth(identity, request), params.couponId, request.body));
  });

  app.post("/api/internal/receiving/receipts", async (request, reply) => {
    return handle(reply, async () => {
      const result = await receiving.finalize(await verifiedAuth(identity, request), request.body);
      reply.status(result.created ? 201 : 200);
      return result.receipt;
    });
  });

  app.get("/api/internal/receiving/receipts", async (request, reply) => {
    return handle(reply, async () => receiving.list(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/receiving/receipts/:receiptId", async (request, reply) => {
    const params = request.params as { receiptId: string };
    return handle(reply, async () => receiving.get(await verifiedAuth(identity, request), params.receiptId));
  });

  app.post("/api/internal/receiving/receipts/:receiptId/corrections", async (request, reply) => {
    const params = request.params as { receiptId: string };
    return handle(reply, async () => {
      const result = await receiving.correct(
        await verifiedAuth(identity, request),
        params.receiptId,
        request.body,
      );
      reply.status(result.created ? 201 : 200);
      return result.receipt;
    });
  });

  app.get("/api/internal/receiving/operations/:operationId", async (request, reply) => {
    const params = request.params as { operationId: string };
    return handle(reply, async () =>
      receiving.getByOperation(await verifiedAuth(identity, request), params.operationId),
    );
  });

  app.get("/api/internal/inventory/batches", async (request, reply) => {
    return handle(reply, async () => inventory.listBatches(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/inventory/low-stock", async (request, reply) => {
    return handle(reply, async () => inventory.listLowStock(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/inventory/settings", async (request, reply) => {
    return handle(reply, async () => inventory.getSettings(await verifiedAuth(identity, request)));
  });

  app.patch("/api/internal/inventory/settings", async (request, reply) => {
    return handle(reply, async () =>
      inventory.updateSettings(await verifiedAuth(identity, request), request.body),
    );
  });

  app.put("/api/internal/inventory/variants/:variantId/low-stock-threshold", async (request, reply) => {
    const params = request.params as { variantId: string };
    return handle(reply, async () =>
      inventory.setVariantThreshold(await verifiedAuth(identity, request), params.variantId, request.body),
    );
  });

  app.get("/api/internal/inventory/count-coordination", async (request, reply) => {
    return handle(reply, async () => inventory.currentCoordination(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/inventory/stock-pause", async (request, reply) => {
    return handle(reply, async () => inventory.currentStockPause(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/inventory/count-coordination/acknowledgements", async (request, reply) => {
    return handle(reply, async () => inventory.acknowledgeCoordination(await verifiedAuth(identity, request), request.body));
  });

  app.post("/api/internal/inventory/count-coordination", async (request, reply) => {
    return handle(reply, async () => {
      const result = await inventory.startCoordination(await verifiedAuth(identity, request), request.body);
      reply.status(result.created ? 201 : 200);
      return result.value;
    });
  });

  app.post("/api/internal/inventory/count-coordination/cancel", async (request, reply) => {
    return handle(reply, async () => inventory.cancelCoordination(await verifiedAuth(identity, request), request.body));
  });

  app.get("/api/internal/inventory/stock-corrections", async (request, reply) => {
    return handle(reply, async () => inventory.listStockCorrections(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/inventory/stock-corrections", async (request, reply) => {
    return handle(reply, async () => {
      const result = await inventory.finalizeStockCorrection(await verifiedAuth(identity, request), request.body);
      reply.status(result.created ? 201 : 200);
      return result.value;
    });
  });

  app.get("/api/internal/inventory/stock-reconciliations", async (request, reply) => {
    return handle(reply, async () => inventory.listStockReconciliations(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/inventory/stock-reconciliation-cases", async (request, reply) => {
    return handle(reply, async () => inventory.listStockReconciliationCases(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/inventory/stock-reconciliations", async (request, reply) => {
    return handle(reply, async () => {
      const result = await inventory.reconcileLateSale(await verifiedAuth(identity, request), request.body);
      reply.status(result.created ? 201 : 200);
      return result.value;
    });
  });

  app.post("/api/internal/sales/pos-snapshots", async (request, reply) => {
    return handle(reply, async () => {
      const snapshot = await sales.issuePriceSnapshot(await verifiedAuth(identity, request), request.body);
      reply.status(201);
      return snapshot;
    });
  });

  app.post("/api/internal/sales/prepare", async (request, reply) => {
    return handle(reply, async () => {
      const result = await sales.prepare(await verifiedAuth(identity, request), request.body);
      reply.status(result.created ? 201 : 200);
      return result.sale;
    });
  });

  app.post("/api/internal/sales/accepted", async (request, reply) => {
    return handle(reply, async () => {
      const result = await sales.acceptOffline(await verifiedAuth(identity, request), request.body);
      reply.status(result.created ? 201 : 200);
      return { ...result.sale, acknowledgement: result.acknowledgement };
    });
  });

  app.post("/api/internal/sales/recover", async (request, reply) => {
    return handle(reply, async () => {
      const result = await sales.recoverOffline(await verifiedAuth(identity, request), request.body);
      reply.status(result.created ? 201 : 200);
      return { ...result.sale, acknowledgement: result.acknowledgement };
    });
  });

  app.get("/api/internal/sales/restore-deferred", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return handle(reply, async () => sales.listDeferredForRestore(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/sales", async (request, reply) => {
    return handle(reply, async () => {
      const result = await sales.complete(await verifiedAuth(identity, request), request.body);
      reply.status(result.created ? 201 : 200);
      return { ...result.sale, acknowledgement: result.acknowledgement };
    });
  });

  app.get("/api/internal/sales", async (request, reply) => {
    return handle(reply, async () => sales.list(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/sales/operations/:operationId", async (request, reply) => {
    const params = request.params as { operationId: string };
    return handle(reply, async () =>
      sales.getByOperation(await verifiedAuth(identity, request), params.operationId),
    );
  });

  app.get("/api/internal/sales/:saleId", async (request, reply) => {
    const params = request.params as { saleId: string };
    return handle(reply, async () => sales.get(await verifiedAuth(identity, request), params.saleId));
  });

  app.get("/api/internal/expense-categories", async (request, reply) => {
    return handle(reply, async () => expenses.listCategories(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/expense-categories", async (request, reply) => {
    return handle(reply, async () => {
      const category = await expenses.createCategory(await verifiedAuth(identity, request), request.body);
      reply.status(201);
      return category;
    });
  });

  app.patch("/api/internal/expense-categories/:categoryId", async (request, reply) => {
    const params = request.params as { categoryId: string };
    return handle(reply, async () =>
      expenses.updateCategory(await verifiedAuth(identity, request), params.categoryId, request.body),
    );
  });

  app.post("/api/internal/expenses", async (request, reply) => {
    return handle(reply, async () => {
      const result = await expenses.create(await verifiedAuth(identity, request), request.body);
      reply.status(result.created ? 201 : 200);
      return result.expense;
    });
  });

  app.get("/api/internal/expenses", async (request, reply) => {
    return handle(reply, async () => expenses.list(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/expenses/totals", async (request, reply) => {
    return handle(reply, async () => expenses.totals(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/expenses/operations/:operationId", async (request, reply) => {
    const params = request.params as { operationId: string };
    return handle(reply, async () =>
      expenses.getByOperation(await verifiedAuth(identity, request), params.operationId),
    );
  });

  app.post("/api/internal/expenses/:expenseId/changes", async (request, reply) => {
    const params = request.params as { expenseId: string };
    return handle(reply, async () => {
      const result = await expenses.change(await verifiedAuth(identity, request), params.expenseId, request.body);
      reply.status(result.created ? 201 : 200);
      return result.expense;
    });
  });

  app.get("/api/internal/expenses/:expenseId", async (request, reply) => {
    const params = request.params as { expenseId: string };
    return handle(reply, async () => expenses.get(await verifiedAuth(identity, request), params.expenseId));
  });

  app.get("/api/internal/returns/sources-page", async (request, reply) => {
    return handle(reply, async () => returns.listSourcesPage(await verifiedAuth(identity, request), request.query));
  });

  app.get("/api/internal/returns/sources", async (request, reply) => {
    return handle(reply, async () => returns.listSources(await verifiedAuth(identity, request), request.query));
  });

  app.post("/api/internal/returns", async (request, reply) => {
    return handle(reply, async () => {
      const result = await returns.createDraft(await verifiedAuth(identity, request), request.body);
      reply.status(result.created ? 201 : 200);
      return result.value;
    });
  });

  app.patch("/api/internal/returns/:returnId", async (request, reply) => {
    const params = request.params as { returnId: string };
    return handle(reply, async () =>
      returns.updateDraft(await verifiedAuth(identity, request), params.returnId, request.body),
    );
  });

  app.get("/api/internal/returns", async (request, reply) => {
    return handle(reply, async () => returns.list(await verifiedAuth(identity, request), request.query));
  });

  app.post("/api/internal/returns/:returnId/post", async (request, reply) => {
    const params = request.params as { returnId: string };
    return handle(reply, async () => {
      const result = await returns.post(await verifiedAuth(identity, request), params.returnId, request.body);
      reply.status(result.created ? 201 : 200);
      return result.value;
    });
  });

  app.post("/api/internal/returns/:returnId/refund", async (request, reply) => {
    const params = request.params as { returnId: string };
    return handle(reply, async () => {
      const result = await returns.markPaid(await verifiedAuth(identity, request), params.returnId, request.body);
      reply.status(result.created ? 201 : 200);
      return result.value;
    });
  });

  app.post("/api/internal/returns/:returnId/exchange", async (request, reply) => {
    const params = request.params as { returnId: string };
    return handle(reply, async () => {
      const result = await returns.exchange(await verifiedAuth(identity, request), params.returnId, request.body);
      reply.status(result.created ? 201 : 200);
      return result.value;
    });
  });

  app.post("/api/internal/returns/:returnId/exchange-quote", async (request, reply) => {
    const params = request.params as { returnId: string };
    return handle(reply, async () => {
      const result = await returns.quoteExchange(await verifiedAuth(identity, request), params.returnId, request.body);
      reply.status(result.created ? 201 : 200);
      return result.value;
    });
  });

  app.get("/api/internal/returns/:returnId", async (request, reply) => {
    const params = request.params as { returnId: string };
    return handle(reply, async () => returns.get(await verifiedAuth(identity, request), params.returnId));
  });

  app.get("/api/internal/corrections/sales/:saleId", async (request, reply) => {
    const params = request.params as { saleId: string };
    return handle(reply, async () => corrections.getSale(await verifiedAuth(identity, request), params.saleId));
  });

  app.post("/api/internal/corrections/sales/:saleId", async (request, reply) => {
    const params = request.params as { saleId: string };
    return handle(reply, async () => {
      const result = await corrections.changeSale(await verifiedAuth(identity, request), params.saleId, request.body);
      reply.status(result.created ? 201 : 200);
      return result.value;
    });
  });

  app.get("/api/internal/corrections/returns/:returnId", async (request, reply) => {
    const params = request.params as { returnId: string };
    return handle(reply, async () => corrections.getReturn(await verifiedAuth(identity, request), params.returnId));
  });

  app.post("/api/internal/corrections/returns/:returnId", async (request, reply) => {
    const params = request.params as { returnId: string };
    return handle(reply, async () => {
      const result = await corrections.changeReturn(await verifiedAuth(identity, request), params.returnId, request.body);
      reply.status(result.created ? 201 : 200);
      return result.value;
    });
  });
}

function publicOrderingDisabled(reply: FastifyReply) {
  return reply.status(503).send({
    error: {
      code: "PUBLIC_ORDERING_DISABLED",
      messageAr: "الطلب عبر المتجر غير متاح حالياً.",
    },
  });
}

function isPrivilegedPath(url: string): boolean {
  return url.startsWith("/api/auth") || url.startsWith("/api/internal");
}

function isTrustedInternalOrigin(request: FastifyRequest, config: AppConfig): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    return request.method === "GET" || request.method === "HEAD";
  }
  return config.trustedOrigins.includes(origin);
}

async function verifiedAuth(
  identity: IdentityGateway,
  request: FastifyRequest,
): Promise<VerifiedAuth | null> {
  const cookie = request.headers.cookie;
  return identity.getVerifiedAuth(typeof cookie === "string" ? cookie : "");
}

async function forwardAuth(
  auth: ReturnType<typeof createBetterAuth>,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const url = new URL(request.url, configFallbackUrl(request));
  const headers = requestHeaders(request);
  // Sign-in rate limits are kept per client connection address.
  headers.set("x-bravos-client-ip", request.ip);
  const payload =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : JSON.stringify(request.body ?? {});
  if (payload) {
    headers.set("content-type", "application/json");
  }
  const response = await auth.handler(
    new Request(
      url,
      payload
        ? { method: request.method, headers, body: payload }
        : { method: request.method, headers },
    ),
  );
  const pathname = url.pathname.replace(/\/$/, "");
  const text = await response.text();
  if (response.status >= 500) {
    return reply.status(500).send(errorBody("CONFLICT", "تعذر إكمال العملية."));
  }
  if (response.status === 429) {
    return reply.status(429).send(errorBody("RATE_LIMITED", "محاولات دخول كثيرة. انتظر قليلاً ثم أعد المحاولة."));
  }
  if (response.status >= 400) {
    return reply.status(401).send(errorBody("UNAUTHENTICATED", "يلزم تسجيل الدخول."));
  }
  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "content-length" || lower === "content-type") {
      return;
    }
    reply.header(key, value);
  });
  reply.status(response.status);
  if (pathname.endsWith("/get-session")) {
    const raw = text ? safeParse(text) : null;
    const authenticated = Boolean(
      raw && typeof raw === "object" && "user" in raw && (raw as { user?: unknown }).user,
    );
    return reply.send({ authenticated });
  }
  return reply.send({ ok: true });
}

function sanitizePoolError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return `PostgreSQL pool error: ${raw.replace(/postgres:\/\/[^@\s]+@/gi, "postgres://***@")}`;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function configFallbackUrl(request: FastifyRequest): string {
  const host = request.headers.host ?? "127.0.0.1";
  return `http://${host}`;
}

function requestHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

function asObject(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function decodeBase64(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length < 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new CatalogValidationError("بيانات الصورة غير صالحة.");
  }
  const bytes = Buffer.from(value, "base64");
  const canonical = bytes.toString("base64").replace(/=+$/, "");
  if (canonical !== value.replace(/=+$/, "")) {
    throw new CatalogValidationError("بيانات الصورة غير صالحة.");
  }
  return bytes;
}

async function handle(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (error) {
    return sendError(reply, error);
  }
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof UnauthenticatedError) {
    return reply.status(401).send(errorBody(error.code, error.message));
  }
  if (error instanceof ForbiddenError) {
    return reply.status(403).send(errorBody(error.code, error.message));
  }
  if (error instanceof BranchNotAuthorizedError) {
    return reply.status(403).send(errorBody(error.code, error.message));
  }
  if (error instanceof DuplicateLoginNameError) {
    return reply.status(409).send(errorBody(error.code, error.message));
  }
  if (error instanceof DuplicateProductCodeError) {
    return reply.status(409).send(errorBody(error.code, error.message));
  }
  if (error instanceof ReferencedVariantError) {
    return reply.status(409).send(errorBody(error.code, error.message));
  }
  if (error instanceof OperationConflictError) {
    return reply.status(409).send(errorBody(error.code, error.message));
  }
  if (error instanceof BackupInProgressError) {
    return reply.status(409).send(errorBody(error.code, error.message));
  }
  if (error instanceof RestorePausedError) {
    return reply.status(409).send(errorBody(error.code, error.message));
  }
  if (isRestorePausedDatabaseError(error)) {
    return reply.status(409).send(errorBody("RESTORE_PAUSED", "تغييرات العمل متوقفة مؤقتاً لإتمام استعادة البيانات."));
  }
  if (error instanceof RestoreStaleError || error instanceof SaleRetainedForRestoreError
    || error instanceof SaleRestoreGenerationChangedError) {
    return reply.status(409).send(errorBody(error.code, error.message));
  }
  if (error instanceof AnalyticsOperationConflictError) {
    return reply.status(409).send(errorBody(error.code, error.message));
  }
  if (error instanceof StockMutationPausedError || error instanceof CoordinationStaleError) {
    return reply.status(409).send(errorBody(error.code, error.message));
  }
  if (error instanceof CouponUsageConflictError) {
    return reply.status(409).send(errorBody(error.code, error.message));
  }
  if (error instanceof ExpenseOperationConflictError || error instanceof ExpenseRevisionConflictError) {
    return reply.status(409).send(errorBody(error.code, error.message));
  }
  if (
    error instanceof OnlineOrderOperationConflictError ||
    error instanceof OnlineOrderRevisionConflictError ||
    error instanceof OnlineOrderStateConflictError ||
    error instanceof QuoteAlreadyUsedError ||
    error instanceof QuoteStaleError ||
    error instanceof VariantNotOrderableError ||
    error instanceof InsufficientStockError ||
    error instanceof UnreachablePolicyError
  ) {
    return reply.status(409).send(errorBody(error.code, error.message));
  }
  if (error instanceof UnsupportedDeliveryAreaError) {
    return reply.status(400).send(errorBody(error.code, error.message));
  }
  if (error instanceof OpeningImportStaleError) {
    return reply.status(409).send(errorBody("OPENING_IMPORT_STALE", error.message));
  }
  if (error instanceof OpeningImportConflictError) {
    return reply.status(409).send(errorBody("OPERATION_CONFLICT", error.message));
  }
  if (
    error instanceof IdentityValidationError ||
    error instanceof CatalogValidationError ||
    error instanceof InventoryValidationError ||
    error instanceof ReceivingValidationError ||
    error instanceof PricingValidationError ||
    error instanceof SalesValidationError ||
    error instanceof ExpensesValidationError ||
    error instanceof ReturnsValidationError ||
    error instanceof CorrectionsValidationError ||
    error instanceof StorefrontConfigValidationError
    || error instanceof OnlineOrderValidationError
    || error instanceof OpeningImportValidationError
    || error instanceof BackupValidationError
    || error instanceof RestoreValidationError
    || error instanceof AnalyticsValidationError
    || error instanceof ReportingValidationError
    || error instanceof ReportingExportLimitError
    || error instanceof ReportExportValidationError
  ) {
    return reply.status(400).send(errorBody(error.code, error.message));
  }
  if (error instanceof InvalidRecoveryError) {
    return reply.status(400).send(errorBody(error.code, error.message));
  }
  if (error instanceof NotFoundError) {
    return reply.status(404).send(errorBody(error.code, error.message));
  }
  const requestId = reply.request.id;
  const routeTemplate = reply.request.routeOptions.url;
  console.error("api.unexpected_failure", {
    category: "unexpected_operation_failure",
    requestId: typeof requestId === "string" ? requestId : "unavailable",
    routeTemplate: typeof routeTemplate === "string" && routeTemplate.length > 0 ? routeTemplate : "unmatched",
  });
  return reply.status(500).send(errorBody("CONFLICT", "تعذر إكمال العملية."));
}

function errorBody(code: string, messageAr: string) {
  return { error: { code, messageAr } };
}
