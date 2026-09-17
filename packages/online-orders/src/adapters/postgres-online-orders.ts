import type {
  DeliveryAreaDto,
  CompletedOnlineOrderDto,
  OnlineOrderAgreementQuoteDto,
  OnlineOrderContactAttemptDto,
  OnlineOrderDto,
  OnlineOrderFailedReturnInspectionDto,
  OnlineOrderLifecycleEventDto,
  OnlineOrderLineDto,
  OnlineOrderSettingsDto,
} from "@bravos/contracts";
import type { CheckoutQuoteDto, PublicDeliveryAreaDto, PublicOrderSubmissionDto } from "@bravos/contracts/public";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { OnlineOrderValidationError, QuoteAlreadyUsedError } from "../domain/errors.ts";
import type {
  AcceptedOrderWrite,
  AgreementQuoteWrite,
  CheckoutDependencies,
  DeliveryAreaWrite,
  OnlineOrderStore,
  OnlineOrderUnitOfWork,
  StoredOrderOperation,
  StoredQuote,
} from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;
type AreaRow = {
  id: string;
  name_ar: string;
  fee_piasters: number | string;
  active: boolean;
  changed_by_staff_id: string;
  changed_at: Date;
};
type QuoteRow = {
  id: string;
  request_fingerprint: string;
  request_json: StoredQuote["request"];
  quote_json: CheckoutQuoteDto;
  created_at: Date;
};
type SubmissionRow = {
  id: string;
  operation_id: string;
  payload_fingerprint: string;
  reference: string;
  status: string;
  submitted_at: Date;
  quote_json: CheckoutQuoteDto;
};
type OrderRow = {
  id: string;
  operation_id: string;
  reference: string;
  status: OnlineOrderDto["status"];
  revision: number;
  customer_name: string;
  primary_phone: string;
  alternate_phone: string | null;
  detailed_address: string;
  landmark: string | null;
  notes: string | null;
  delivery_area_id: string;
  requested_delivery_area_name_ar: string;
  requested_delivery_fee_piasters: number | string;
  requested_coupon_code: string | null;
  requested_merchandise_original_piasters: number | string;
  requested_automatic_offer_discount_piasters: number | string;
  requested_coupon_discount_piasters: number | string;
  requested_merchandise_total_piasters: number | string;
  requested_final_total_piasters: number | string;
  requested_applied_automatic_offer: OnlineOrderDto["requestedAppliedAutomaticOffer"];
  requested_applied_coupon: OnlineOrderDto["requestedAppliedCoupon"];
  confirmed_by_staff_id: string | null;
  confirmed_at: Date | null;
  cancelled_by_staff_id: string | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  submitted_at: Date;
};
type LineRow = {
  id: string;
  variant_id: string;
  product_id: string;
  product_name_ar: string;
  size_name_ar: string;
  color_name_ar: string;
  requested_quantity: number;
  requested_listed_unit_price_piasters: number | string;
  requested_original_piasters: number | string;
  requested_automatic_offer_discount_piasters: number | string;
  requested_coupon_discount_piasters: number | string;
  requested_merchandise_total_piasters: number | string;
};
type AgreementQuoteRow = {
  id: string;
  order_id: string;
  order_revision: number;
  request_fingerprint: string;
  review_digest: string;
  request_json: AgreementQuoteWrite["request"];
  quote_json: OnlineOrderAgreementQuoteDto;
  pricing_snapshot_json: AgreementQuoteWrite["pricingSnapshot"];
  reviewed_by_staff_id: string;
  reviewed_at: Date;
};
type OperationRow = {
  operation_id: string;
  order_id: string;
  operation_type: StoredOrderOperation["operationType"];
  payload_fingerprint: string;
  response_json: OnlineOrderDto;
  actor_staff_id: string;
  accepted_at: Date;
};
type ContactAttemptRow = {
  id: string;
  operation_id: string;
  actor_staff_id: string;
  outcome: OnlineOrderContactAttemptDto["outcome"];
  note: string | null;
  occurred_at: Date;
};
type AgreedRevisionRow = {
  version: number;
  operation_id: string;
  agreed_by_staff_id: string;
  agreed_at: Date;
  quote_json: OnlineOrderAgreementQuoteDto;
};
type ConfirmationRow = {
  operation_id: string;
  confirmed_quote_json: OnlineOrderAgreementQuoteDto;
  confirmed_by_staff_id: string;
  confirmed_at: Date;
};
type FulfillmentEventRow = {
  id: string;
  operation_id: string;
  event_type: OnlineOrderLifecycleEventDto["type"];
  from_status: OnlineOrderDto["status"];
  to_status: OnlineOrderDto["status"];
  actor_staff_id: string;
  occurred_at: Date;
  recorded_at: Date;
  reason: string | null;
};
type InspectionRow = {
  id: string;
  draft_operation_id: string;
  status: OnlineOrderFailedReturnInspectionDto["status"];
  recorded_by_staff_id: string;
  recorded_at: Date;
  posted_by_staff_id: string | null;
  posted_at: Date | null;
  abandoned_by_staff_id: string | null;
  abandoned_at: Date | null;
  abandonment_reason: string | null;
};
type InspectionLineRow = {
  inspection_id: string;
  confirmed_line_id: string;
  variant_id: string;
  received_quantity: number;
  sellable_quantity: number;
};
type UnreachableCancellationRow = {
  operation_id: string;
  cancelled_by_staff_id: string;
  cancelled_at: Date;
  reason: string;
};
type SettingsRow = {
  revision: number;
  unreachable_wait_hours: number;
  minimum_contact_attempts: number;
  changed_by_staff_id: string | null;
  changed_at: Date | null;
};

export function createPostgresOnlineOrderStore(queryable: Queryable): OnlineOrderStore {
  return {
    async listPublicAreas() {
      const rows = await queryable.query<AreaRow>(
        "SELECT * FROM delivery_area WHERE active = true ORDER BY name_ar, id",
      );
      return rows.rows.map(publicArea);
    },
    async listAreas() {
      const rows = await queryable.query<AreaRow>("SELECT * FROM delivery_area ORDER BY name_ar, id");
      return rows.rows.map(area);
    },
    async getArea(id) {
      const result = await queryable.query<AreaRow>("SELECT * FROM delivery_area WHERE id=$1", [id]);
      return result.rows[0] ? area(result.rows[0]) : null;
    },
    async insertArea(input) {
      try {
        const result = await queryable.query<AreaRow>(
          `INSERT INTO delivery_area (id,name_ar,fee_piasters,active,changed_by_staff_id,changed_at)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          areaValues(input),
        );
        return area(required(result.rows[0]));
      } catch (error) { throw mapAreaError(error); }
    },
    async updateArea(input) {
      try {
        const result = await queryable.query<AreaRow>(
          `UPDATE delivery_area SET name_ar=$2,fee_piasters=$3,active=$4,changed_by_staff_id=$5,changed_at=$6
           WHERE id=$1 RETURNING *`,
          areaValues(input),
        );
        return result.rows[0] ? area(result.rows[0]) : null;
      } catch (error) { throw mapAreaError(error); }
    },
    async insertQuote(input) {
      await queryable.query(
        `INSERT INTO online_checkout_quote (id,request_fingerprint,request_json,quote_json,created_at)
         VALUES ($1,$2,$3::jsonb,$4::jsonb,$5)`,
        [input.id, input.requestFingerprint, JSON.stringify(input.request), JSON.stringify(input.quote), input.createdAt],
      );
    },
    async getQuote(id, lock = false) {
      const result = await queryable.query<QuoteRow>(
        `SELECT id,request_fingerprint,request_json,quote_json,created_at FROM online_checkout_quote
         WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
        [id],
      );
      const row = result.rows[0];
      return row ? {
        id: row.id,
        requestFingerprint: row.request_fingerprint,
        request: row.request_json,
        quote: row.quote_json,
        createdAt: row.created_at,
      } : null;
    },
    async getSubmissionByOperation(operationId) {
      const result = await queryable.query<SubmissionRow>(
        `SELECT o.id,o.operation_id,o.payload_fingerprint,o.reference,o.status,o.submitted_at,q.quote_json
         FROM online_order o JOIN online_checkout_quote q ON q.id=o.quote_id WHERE o.operation_id=$1`,
        [operationId],
      );
      const row = result.rows[0];
      return row ? { payloadFingerprint: row.payload_fingerprint, result: publicSubmission(row) } : null;
    },
    async insertOrder(input) {
      try {
        const inserted = await queryable.query<{ reference: string }>(
          `INSERT INTO online_order (
             id,operation_id,payload_fingerprint,quote_id,reference,status,customer_name,primary_phone,
             alternate_phone,detailed_address,landmark,notes,delivery_area_id,requested_delivery_area_name_ar,
             requested_coupon_code,requested_merchandise_original_piasters,
             requested_automatic_offer_discount_piasters,requested_coupon_discount_piasters,
             requested_merchandise_total_piasters,requested_delivery_fee_piasters,requested_final_total_piasters,
             requested_applied_automatic_offer,requested_applied_coupon,submitted_at
           ) VALUES (
             $1,$2,$3,$4,concat('BRV-',lpad(nextval('online_order_reference_number_seq')::text,6,'0')),
             'pending',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb,$22
           ) RETURNING reference`,
          [
            input.id,input.operationId,input.payloadFingerprint,input.quoteId,input.customerName,input.primaryPhone,
            input.alternatePhone,input.detailedAddress,input.landmark,input.notes,input.deliveryAreaId,input.quote.area.nameAr,
            input.couponCode,input.quote.merchandiseOriginalPiasters,input.quote.automaticOfferDiscountPiasters,
            input.quote.couponDiscountPiasters,input.quote.merchandiseTotalPiasters,input.quote.deliveryFeePiasters,
            input.quote.finalTotalPiasters,JSON.stringify(input.quote.appliedAutomaticOffer),
            JSON.stringify(input.quote.appliedCoupon),input.submittedAt,
          ],
        );
        for (const [lineIndex, line] of input.quote.lines.entries()) {
          await queryable.query(
            `INSERT INTO online_order_line (
               id,order_id,variant_id,product_id,product_name_ar,size_name_ar,color_name_ar,requested_quantity,
               requested_listed_unit_price_piasters,requested_original_piasters,
               requested_automatic_offer_discount_piasters,requested_coupon_discount_piasters,
               requested_merchandise_total_piasters,line_index
             ) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [input.id,line.variantId,line.productId,line.productNameAr,line.sizeNameAr,line.colorNameAr,line.quantity,
              line.listedUnitPricePiasters,line.originalPiasters,line.automaticOfferDiscountPiasters,
              line.couponDiscountPiasters,line.merchandiseTotalPiasters,lineIndex],
          );
        }
        return {
          orderId: input.id,
          reference: required(inserted.rows[0]).reference,
          status: "pending",
          submittedAt: input.submittedAt.toISOString(),
          quote: input.quote,
        };
      } catch (error) {
        if (pgCode(error) === "23505" && pgConstraint(error) === "online_order_quote_id_key") throw new QuoteAlreadyUsedError();
        throw error;
      }
    },
    async listOrders() {
      const result = await queryable.query<{ id: string }>("SELECT id FROM online_order ORDER BY submitted_at DESC,id DESC");
      const orders = await Promise.all(result.rows.map((row) => loadOrder(queryable, row.id)));
      return orders.filter((order): order is OnlineOrderDto => order !== null);
    },
    async listCompletedOrders() {
      const result = await queryable.query<{
        id: string;
        reference: string;
        delivered_at: Date;
        return_deadline_at: Date;
        confirmed_quote_json: OnlineOrderAgreementQuoteDto;
      }>(
        `SELECT order_row.id,order_row.reference,event.occurred_at AS delivered_at,
                confirmation.confirmed_quote_json
         FROM online_order order_row
         JOIN online_order_confirmation confirmation ON confirmation.order_id=order_row.id
         JOIN online_order_fulfillment_event event
           ON event.order_id=order_row.id AND event.event_type='delivered'
         WHERE order_row.status='delivered'
         ORDER BY event.occurred_at DESC,order_row.id DESC`,
      );
      return result.rows.map((row): CompletedOnlineOrderDto => ({
        orderId: row.id,
        reference: row.reference,
        deliveredAt: row.delivered_at.toISOString(),
        finalTotalPiasters: integer(row.confirmed_quote_json.finalTotalPiasters),
        confirmedQuote: row.confirmed_quote_json,
      }));
    },
    async listDeliveredSources(search) {
      const values: unknown[] = [];
      const where = ["order_row.status='delivered'", "event.event_type='delivered'"];
      if (search.reference) {
        values.push(search.reference);
        where.push(`(order_row.reference ILIKE '%' || $${values.length} || '%'
          OR order_row.id::text ILIKE '%' || $${values.length} || '%')`);
      }
      if (search.date) {
        values.push(search.date);
        where.push(`(event.occurred_at AT TIME ZONE 'Africa/Cairo')::date = $${values.length}::date`);
      }
      if (search.item) {
        values.push(search.item);
        where.push(`EXISTS (
          SELECT 1 FROM jsonb_array_elements(confirmation.confirmed_quote_json -> 'lines') line
          WHERE line ->> 'productNameAr' ILIKE '%' || $${values.length} || '%'
             OR line ->> 'sizeNameAr' ILIKE '%' || $${values.length} || '%'
             OR line ->> 'colorNameAr' ILIKE '%' || $${values.length} || '%'
        )`);
      }
      if (search.amountPiasters !== undefined) {
        values.push(search.amountPiasters);
        where.push(`(confirmation.confirmed_quote_json ->> 'finalTotalPiasters')::bigint = $${values.length}::bigint`);
      }
      const result = await queryable.query<{
        id: string;
        reference: string;
        customer_name: string;
        primary_phone: string;
        delivered_at: Date;
        return_deadline_at: Date;
        confirmed_quote_json: OnlineOrderAgreementQuoteDto;
      }>(
        `SELECT order_row.id,order_row.reference,order_row.customer_name,order_row.primary_phone,
                event.occurred_at AS delivered_at,
                ((event.occurred_at AT TIME ZONE 'Africa/Cairo') + interval '14 days')
                  AT TIME ZONE 'Africa/Cairo' AS return_deadline_at,
                confirmation.confirmed_quote_json
         FROM online_order order_row
         JOIN online_order_confirmation confirmation ON confirmation.order_id=order_row.id
         JOIN online_order_fulfillment_event event ON event.order_id=order_row.id
         WHERE ${where.join(" AND ")}
         ORDER BY event.occurred_at DESC,order_row.id DESC LIMIT 100`,
        values,
      );
      return result.rows.map((row) => ({
        orderId: row.id,
        reference: row.reference,
        customerName: row.customer_name,
        primaryPhone: row.primary_phone,
        customerReceivedAt: row.delivered_at,
        returnDeadlineAt: row.return_deadline_at,
        confirmedQuote: row.confirmed_quote_json,
      }));
    },
    async getDeliveredSource(orderId, lock = false) {
      const result = await queryable.query<{
        id: string;
        reference: string;
        customer_name: string;
        primary_phone: string;
        delivered_at: Date;
        return_deadline_at: Date;
        confirmed_quote_json: OnlineOrderAgreementQuoteDto;
      }>(
        `SELECT order_row.id,order_row.reference,order_row.customer_name,order_row.primary_phone,
                event.occurred_at AS delivered_at,
                ((event.occurred_at AT TIME ZONE 'Africa/Cairo') + interval '14 days')
                  AT TIME ZONE 'Africa/Cairo' AS return_deadline_at,
                confirmation.confirmed_quote_json
         FROM online_order order_row
         JOIN online_order_confirmation confirmation ON confirmation.order_id=order_row.id
         JOIN online_order_fulfillment_event event
           ON event.order_id=order_row.id AND event.event_type='delivered'
         WHERE order_row.id=$1 AND order_row.status='delivered'
         ${lock ? "FOR UPDATE OF order_row" : ""}`,
        [orderId],
      );
      const row = result.rows[0];
      return row ? {
        orderId: row.id,
        reference: row.reference,
        customerName: row.customer_name,
        primaryPhone: row.primary_phone,
        customerReceivedAt: row.delivered_at,
        returnDeadlineAt: row.return_deadline_at,
        confirmedQuote: row.confirmed_quote_json,
      } : null;
    },
    getOrder(id, lock = false) { return loadOrder(queryable, id, lock); },
    async insertAgreementQuote(input) {
      await queryable.query(
        `INSERT INTO online_order_agreement_quote (
           id,order_id,order_revision,request_fingerprint,review_digest,request_json,quote_json,
           pricing_snapshot_json,reviewed_by_staff_id,reviewed_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)`,
        [input.id,input.orderId,input.orderRevision,input.requestFingerprint,input.reviewDigest,
          JSON.stringify(input.request),JSON.stringify(input.quote),JSON.stringify(input.pricingSnapshot),
          input.actorStaffId,input.reviewedAt],
      );
    },
    async getAgreementQuote(id, lock = false) {
      const result = await queryable.query<AgreementQuoteRow>(
        `SELECT * FROM online_order_agreement_quote WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
        [id],
      );
      return result.rows[0] ? agreementQuote(result.rows[0]) : null;
    },
    async getOperation(operationId) {
      const result = await queryable.query<OperationRow>("SELECT * FROM online_order_operation WHERE operation_id=$1", [operationId]);
      const row = result.rows[0];
      return row ? {
        operationId: row.operation_id, orderId: row.order_id, operationType: row.operation_type,
        payloadFingerprint: row.payload_fingerprint, response: row.response_json,
        actorStaffId: row.actor_staff_id, acceptedAt: row.accepted_at,
      } : null;
    },
    async insertContactAttempt(input) {
      await insertOperationShell(queryable, input, "contact_attempt", input.occurredAt);
      await queryable.query(
        `INSERT INTO online_order_contact_attempt
           (id,order_id,operation_id,actor_staff_id,outcome,note,occurred_at)
         VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6)`,
        [input.orderId,input.operationId,input.actorStaffId,input.outcome,input.note,input.occurredAt],
      );
      await setRevision(queryable, input.orderId, input.nextRevision);
      return finishOperation(queryable, input.operationId, input.orderId);
    },
    async insertAgreedRevision(input) {
      await insertOperationShell(queryable, input, "agreed_revision", input.agreedAt);
      await queryable.query(
        `INSERT INTO online_order_agreed_revision
           (order_id,version,operation_id,quote_id,review_digest,agreed_by_staff_id,agreed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [input.orderId,input.nextRevision,input.operationId,input.quoteId,input.reviewDigest,input.actorStaffId,input.agreedAt],
      );
      await setRevision(queryable, input.orderId, input.nextRevision);
      return finishOperation(queryable, input.operationId, input.orderId);
    },
    async confirm(input) {
      await insertOperationShell(queryable, input, "confirmation", input.confirmedAt);
      await queryable.query(
        `INSERT INTO online_order_confirmation (
           order_id,operation_id,agreed_revision,quote_id,review_digest,confirmed_quote_json,
           pricing_snapshot_json,confirmed_by_staff_id,confirmed_at
         ) SELECT $1,$2,$3,$4,$5,q.quote_json,q.pricing_snapshot_json,$6,$7
           FROM online_order_agreement_quote q WHERE q.id=$4`,
        [input.orderId,input.operationId,input.agreedRevision,input.quoteId,input.reviewDigest,input.actorStaffId,input.confirmedAt],
      );
      await queryable.query(
        `UPDATE online_order SET status='confirmed',revision=$2,confirmed_by_staff_id=$3,confirmed_at=$4 WHERE id=$1`,
        [input.orderId,input.nextRevision,input.actorStaffId,input.confirmedAt],
      );
      return finishOperation(queryable, input.operationId, input.orderId);
    },
    async cancelUnreachable(input) {
      await insertOperationShell(queryable, input, "unreachable_cancellation", input.cancelledAt);
      await queryable.query(
        `INSERT INTO online_order_unreachable_cancellation
           (order_id,operation_id,reason,cancelled_by_staff_id,cancelled_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [input.orderId,input.operationId,input.reason,input.actorStaffId,input.cancelledAt],
      );
      await queryable.query(
        `UPDATE online_order SET status='cancelled_unreachable',revision=$2,cancelled_by_staff_id=$3,
           cancelled_at=$4,cancellation_reason=$5 WHERE id=$1`,
        [input.orderId,input.nextRevision,input.actorStaffId,input.cancelledAt,input.reason],
      );
      return finishOperation(queryable, input.operationId, input.orderId);
    },
    async transition(input) {
      await insertOperationShell(queryable, input, input.operationType, input.recordedAt);
      await queryable.query(
        `INSERT INTO online_order_fulfillment_event (
           id, order_id, operation_id, event_type, from_status, to_status,
           actor_staff_id, occurred_at, recorded_at, reason
         ) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [input.orderId,input.operationId,input.eventType,input.fromStatus,input.toStatus,
          input.actorStaffId,input.occurredAt,input.recordedAt,input.reason],
      );
      const cancelled = input.toStatus === "cancelled_before_shipment"
        || input.toStatus === "cancelled_after_failed_delivery";
      const updated = await queryable.query(
        `UPDATE online_order
         SET status=$2,revision=$3,
             cancelled_by_staff_id=CASE WHEN $4 THEN $5 ELSE cancelled_by_staff_id END,
             cancelled_at=CASE WHEN $4 THEN $6 ELSE cancelled_at END,
             cancellation_reason=CASE WHEN $4 THEN $7 ELSE cancellation_reason END
         WHERE id=$1 AND status=$8
         RETURNING id`,
        [input.orderId,input.toStatus,input.nextRevision,cancelled,input.actorStaffId,
          input.recordedAt,input.reason,input.fromStatus],
      );
      if (!updated.rows[0]) throw new OnlineOrderValidationError("تغيرت حالة الطلب أثناء تنفيذ العملية.");
      return finishOperation(queryable, input.operationId, input.orderId);
    },
    async insertFailedReturnInspection(input) {
      await insertOperationShell(queryable, input, "failed_return_inspection_draft", input.recordedAt);
      await queryable.query(
        `INSERT INTO online_order_failed_return_inspection (
           id,order_id,draft_operation_id,status,recorded_by_staff_id,recorded_at
         ) VALUES ($1,$2,$3,'draft',$4,$5)`,
        [input.id,input.orderId,input.operationId,input.actorStaffId,input.recordedAt],
      );
      for (const [index, line] of input.lines.entries()) {
        await queryable.query(
          `INSERT INTO online_order_failed_return_inspection_line (
             inspection_id,confirmed_line_id,variant_id,received_quantity,sellable_quantity,line_index
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [input.id,line.confirmedLineId,line.variantId,line.receivedQuantity,line.sellableQuantity,index],
        );
      }
      await queryable.query(
        `INSERT INTO online_order_fulfillment_event (
           id,order_id,operation_id,event_type,from_status,to_status,actor_staff_id,occurred_at,recorded_at
         ) VALUES (gen_random_uuid(),$1,$2,'failed_return_inspection_drafted','delivery_failed','delivery_failed',$3,$4,$4)`,
        [input.orderId,input.operationId,input.actorStaffId,input.recordedAt],
      );
      await setRevision(queryable,input.orderId,input.nextRevision);
      return finishOperation(queryable,input.operationId,input.orderId);
    },
    async postFailedReturnInspection(input) {
      await insertOperationShell(queryable, input, "failed_return_inspection_post", input.postedAt);
      const posted = await queryable.query(
        `UPDATE online_order_failed_return_inspection
         SET status='posted',posted_operation_id=$3,posted_by_staff_id=$4,posted_at=$5
         WHERE id=$1 AND order_id=$2 AND status='draft'
         RETURNING id`,
        [input.inspectionId,input.orderId,input.operationId,input.actorStaffId,input.postedAt],
      );
      if (!posted.rows[0]) throw new OnlineOrderValidationError("مسودة الفحص غير موجودة أو تم ترحيلها.");
      await queryable.query(
        `INSERT INTO online_order_fulfillment_event (
           id,order_id,operation_id,event_type,from_status,to_status,actor_staff_id,occurred_at,recorded_at
         ) VALUES (gen_random_uuid(),$1,$2,'failed_return_inspection_posted','delivery_failed','delivery_failed',$3,$4,$4)`,
        [input.orderId,input.operationId,input.actorStaffId,input.postedAt],
      );
      await setRevision(queryable,input.orderId,input.nextRevision);
      return finishOperation(queryable,input.operationId,input.orderId);
    },
    async abandonFailedReturnInspection(input) {
      await insertOperationShell(queryable,input,"failed_return_inspection_abandon",input.abandonedAt);
      const abandoned = await queryable.query(
        `UPDATE online_order_failed_return_inspection
         SET status='abandoned',abandoned_by_staff_id=$3,abandoned_at=$4,abandonment_reason=$5
         WHERE id=$1 AND order_id=$2 AND status='draft'
         RETURNING id`,
        [input.inspectionId,input.orderId,input.actorStaffId,input.abandonedAt,input.reason],
      );
      if (!abandoned.rows[0]) throw new OnlineOrderValidationError("مسودة الفحص غير موجودة أو لم تعد مفتوحة.");
      await queryable.query(
        `INSERT INTO online_order_fulfillment_event (
           id,order_id,operation_id,event_type,from_status,to_status,actor_staff_id,occurred_at,recorded_at,reason
         ) VALUES (gen_random_uuid(),$1,$2,'failed_return_inspection_abandoned','delivery_failed','delivery_failed',$3,$4,$4,$5)`,
        [input.orderId,input.operationId,input.actorStaffId,input.abandonedAt,input.reason],
      );
      await setRevision(queryable,input.orderId,input.nextRevision);
      return finishOperation(queryable,input.operationId,input.orderId);
    },
    getFailedReturnInspection(id, lock = false) {
      return loadInspection(queryable,id,lock);
    },
    async getSettings() {
      const result = await queryable.query<SettingsRow>("SELECT * FROM online_order_settings WHERE singleton=TRUE");
      return settings(required(result.rows[0]));
    },
    async updateSettings(input) {
      const result = await queryable.query<SettingsRow>(
        `UPDATE online_order_settings SET revision=revision+1,unreachable_wait_hours=$2,
           minimum_contact_attempts=$3,changed_by_staff_id=$4,changed_at=$5
         WHERE singleton=TRUE AND revision=$1 RETURNING *`,
        [input.expectedRevision,input.unreachableWaitHours,input.minimumContactAttempts,input.actorStaffId,input.changedAt],
      );
      return result.rows[0] ? settings(result.rows[0]) : null;
    },
  };
}

export function createPostgresOnlineOrderUnitOfWork(
  pool: Pool,
  dependenciesFor: (client: PoolClient) => CheckoutDependencies,
): OnlineOrderUnitOfWork {
  return {
    async run(work, operationId) {
      const client = await pool.connect();
      let operationLocked = false;
      try {
        if (operationId) {
          await client.query("SELECT pg_advisory_lock(hashtextextended($1, 19))", [operationId]);
          operationLocked = true;
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
            await client.query("SELECT restore_enter_business_write()");
            const result = await work({ ...dependenciesFor(client), store: createPostgresOnlineOrderStore(client) });
            await client.query("COMMIT");
            return result;
          } catch (error) {
            await client.query("ROLLBACK");
            if (attempt < 2 && retryableTransactionError(error)) continue;
            throw error;
          }
        }
        throw new Error("Online-order transaction retry limit reached.");
      } finally {
        if (operationLocked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 19))", [operationId]);
        client.release();
      }
    },
  };
}

async function loadOrder(queryable: Queryable, id: string, lock = false): Promise<OnlineOrderDto | null> {
  const result = await queryable.query<OrderRow>(`SELECT * FROM online_order WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  const [lineResult, attemptResult, agreedResult, confirmationResult, fulfillmentResult,
    inspectionResult, inspectionLineResult, unreachableResult] = await Promise.all([
    queryable.query<LineRow>("SELECT * FROM online_order_line WHERE order_id=$1 ORDER BY line_index", [id]),
    queryable.query<ContactAttemptRow>("SELECT * FROM online_order_contact_attempt WHERE order_id=$1 ORDER BY occurred_at,id", [id]),
    queryable.query<AgreedRevisionRow>(
      `SELECT r.version,r.operation_id,r.agreed_by_staff_id,r.agreed_at,q.quote_json
       FROM online_order_agreed_revision r JOIN online_order_agreement_quote q ON q.id=r.quote_id
       WHERE r.order_id=$1 ORDER BY r.version DESC LIMIT 1`, [id],
    ),
    queryable.query<ConfirmationRow>(
      `SELECT operation_id,confirmed_quote_json,confirmed_by_staff_id,confirmed_at
       FROM online_order_confirmation WHERE order_id=$1`, [id],
    ),
    queryable.query<FulfillmentEventRow>(
      `SELECT * FROM online_order_fulfillment_event WHERE order_id=$1 ORDER BY recorded_at,id`, [id],
    ),
    queryable.query<InspectionRow>(
      `SELECT id,draft_operation_id,status,recorded_by_staff_id,recorded_at,posted_by_staff_id,posted_at,
              abandoned_by_staff_id,abandoned_at,abandonment_reason
       FROM online_order_failed_return_inspection WHERE order_id=$1 ORDER BY recorded_at,id`, [id],
    ),
    queryable.query<InspectionLineRow>(
      `SELECT line.inspection_id,line.confirmed_line_id,line.variant_id,line.received_quantity,line.sellable_quantity
       FROM online_order_failed_return_inspection_line line
       JOIN online_order_failed_return_inspection inspection ON inspection.id=line.inspection_id
       WHERE inspection.order_id=$1 ORDER BY inspection.recorded_at,line.line_index`, [id],
    ),
    queryable.query<UnreachableCancellationRow>(
      `SELECT operation_id,cancelled_by_staff_id,cancelled_at,reason
       FROM online_order_unreachable_cancellation WHERE order_id=$1`, [id],
    ),
  ]);
  const agreed = agreedResult.rows[0];
  const confirmation = confirmationResult.rows[0];
  const lifecycle: OnlineOrderLifecycleEventDto[] = [];
  if (confirmation) lifecycle.push({
    id: confirmation.operation_id,
    operationId: confirmation.operation_id,
    type: "confirmed",
    fromStatus: "pending",
    toStatus: "confirmed",
    actorStaffId: confirmation.confirmed_by_staff_id,
    occurredAt: confirmation.confirmed_at.toISOString(),
    recordedAt: confirmation.confirmed_at.toISOString(),
    reason: null,
  });
  const unreachable = unreachableResult.rows[0];
  if (unreachable) lifecycle.push({
    id: unreachable.operation_id,
    operationId: unreachable.operation_id,
    type: "cancelled_unreachable",
    fromStatus: "pending",
    toStatus: "cancelled_unreachable",
    actorStaffId: unreachable.cancelled_by_staff_id,
    occurredAt: unreachable.cancelled_at.toISOString(),
    recordedAt: unreachable.cancelled_at.toISOString(),
    reason: unreachable.reason,
  });
  lifecycle.push(...fulfillmentResult.rows.map(lifecycleEvent));
  lifecycle.sort((left,right) => left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id));
  const inspectionLines = new Map<string, InspectionLineRow[]>();
  for (const item of inspectionLineResult.rows) {
    const lines = inspectionLines.get(item.inspection_id) ?? [];
    lines.push(item);
    inspectionLines.set(item.inspection_id,lines);
  }
  const inspections = inspectionResult.rows.map((item) => inspection(item,inspectionLines.get(item.id) ?? []));
  const shipped = fulfillmentResult.rows.find((event) => event.event_type === "shipped");
  const delivered = fulfillmentResult.rows.find((event) => event.event_type === "delivered");
  const failed = fulfillmentResult.rows.find((event) => event.event_type === "delivery_failed");
  return {
    id: row.id, operationId: row.operation_id, reference: row.reference, status: row.status, revision: row.revision,
    customerName: row.customer_name, primaryPhone: row.primary_phone, alternatePhone: row.alternate_phone,
    detailedAddress: row.detailed_address, landmark: row.landmark, notes: row.notes,
    deliveryArea: { id: row.delivery_area_id, nameAr: row.requested_delivery_area_name_ar, feePiasters: integer(row.requested_delivery_fee_piasters) },
    requestedCouponCode: row.requested_coupon_code,
    requestedMerchandiseOriginalPiasters: integer(row.requested_merchandise_original_piasters),
    requestedAutomaticOfferDiscountPiasters: integer(row.requested_automatic_offer_discount_piasters),
    requestedCouponDiscountPiasters: integer(row.requested_coupon_discount_piasters),
    requestedMerchandiseTotalPiasters: integer(row.requested_merchandise_total_piasters),
    requestedDeliveryFeePiasters: integer(row.requested_delivery_fee_piasters),
    requestedFinalTotalPiasters: integer(row.requested_final_total_piasters),
    requestedAppliedAutomaticOffer: row.requested_applied_automatic_offer,
    requestedAppliedCoupon: row.requested_applied_coupon,
    lines: lineResult.rows.map(lineDto),
    contactAttempts: attemptResult.rows.map(contactAttempt),
    agreedRevision: agreed ? {
      version: agreed.version, operationId: agreed.operation_id, agreedByStaffId: agreed.agreed_by_staff_id,
      agreedAt: agreed.agreed_at.toISOString(), quote: agreed.quote_json,
    } : null,
    confirmedQuote: confirmation?.confirmed_quote_json ?? null,
    confirmedByStaffId: row.confirmed_by_staff_id,
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
    shippedAt: shipped?.occurred_at.toISOString() ?? null,
    deliveredAt: delivered?.occurred_at.toISOString() ?? null,
    deliveryFailedAt: failed?.occurred_at.toISOString() ?? null,
    cancelledByStaffId: row.cancelled_by_staff_id,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    cancellationReason: row.cancellation_reason,
    lifecycle,
    failedReturnInspections: inspections,
    actionEligibility: {
      canShip: false,
      canDeliver: false,
      canMarkDeliveryFailed: false,
      canCancelBeforeShipment: false,
      canDraftFailedReturnInspection: false,
      canPostFailedReturnInspection: false,
      canAbandonFailedReturnInspection: false,
      canCloseFailedDelivery: false,
    },
    submittedAt: row.submitted_at.toISOString(),
  };
}

async function loadInspection(
  queryable: Queryable,
  id: string,
  lock = false,
): Promise<OnlineOrderFailedReturnInspectionDto | null> {
  const result = await queryable.query<InspectionRow>(
    `SELECT id,draft_operation_id,status,recorded_by_staff_id,recorded_at,posted_by_staff_id,posted_at,
            abandoned_by_staff_id,abandoned_at,abandonment_reason
     FROM online_order_failed_return_inspection WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  const lines = await queryable.query<InspectionLineRow>(
    `SELECT inspection_id,confirmed_line_id,variant_id,received_quantity,sellable_quantity
     FROM online_order_failed_return_inspection_line WHERE inspection_id=$1 ORDER BY line_index`,
    [id],
  );
  return inspection(row,lines.rows);
}

function inspection(row: InspectionRow, lines: InspectionLineRow[]): OnlineOrderFailedReturnInspectionDto {
  return {
    id: row.id,
    operationId: row.draft_operation_id,
    status: row.status,
    lines: lines.map((line) => ({
      confirmedLineId: line.confirmed_line_id,
      variantId: line.variant_id,
      receivedQuantity: line.received_quantity,
      sellableQuantity: line.sellable_quantity,
      nonsellableQuantity: line.received_quantity - line.sellable_quantity,
    })),
    recordedByStaffId: row.recorded_by_staff_id,
    recordedAt: row.recorded_at.toISOString(),
    postedByStaffId: row.posted_by_staff_id,
    postedAt: row.posted_at?.toISOString() ?? null,
    abandonedByStaffId: row.abandoned_by_staff_id,
    abandonedAt: row.abandoned_at?.toISOString() ?? null,
    abandonmentReason: row.abandonment_reason,
  };
}

function lifecycleEvent(row: FulfillmentEventRow): OnlineOrderLifecycleEventDto {
  return {
    id: row.id,
    operationId: row.operation_id,
    type: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorStaffId: row.actor_staff_id,
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(),
    reason: row.reason,
  };
}

async function insertOperationShell(
  queryable: Queryable,
  input: { orderId: string; operationId: string; payloadFingerprint: string; actorStaffId: string },
  operationType: StoredOrderOperation["operationType"],
  acceptedAt: Date,
) {
  await queryable.query(
    `INSERT INTO online_order_operation
       (operation_id,order_id,operation_type,payload_fingerprint,response_json,actor_staff_id,accepted_at)
     VALUES ($1,$2,$3,$4,'{}'::jsonb,$5,$6)`,
    [input.operationId,input.orderId,operationType,input.payloadFingerprint,input.actorStaffId,acceptedAt],
  );
}

async function setRevision(queryable: Queryable, orderId: string, revision: number) {
  await queryable.query("UPDATE online_order SET revision=$2 WHERE id=$1", [orderId,revision]);
}

async function finishOperation(queryable: Queryable, operationId: string, orderId: string): Promise<OnlineOrderDto> {
  const response = await loadOrder(queryable, orderId);
  if (!response) throw new Error("Accepted online order could not be loaded.");
  await queryable.query("UPDATE online_order_operation SET response_json=$2::jsonb WHERE operation_id=$1", [operationId,JSON.stringify(response)]);
  return response;
}

function agreementQuote(row: AgreementQuoteRow) {
  return {
    id: row.id, orderId: row.order_id, orderRevision: row.order_revision,
    requestFingerprint: row.request_fingerprint, reviewDigest: row.review_digest,
    request: row.request_json, quote: row.quote_json, pricingSnapshot: row.pricing_snapshot_json,
    actorStaffId: row.reviewed_by_staff_id, reviewedAt: row.reviewed_at,
  };
}

function contactAttempt(row: ContactAttemptRow): OnlineOrderContactAttemptDto {
  return { id: row.id, operationId: row.operation_id, actorStaffId: row.actor_staff_id,
    outcome: row.outcome, note: row.note, occurredAt: row.occurred_at.toISOString() };
}

function settings(row: SettingsRow): OnlineOrderSettingsDto {
  return { revision: row.revision, unreachableWaitHours: row.unreachable_wait_hours,
    minimumContactAttempts: row.minimum_contact_attempts, changedByStaffId: row.changed_by_staff_id,
    changedAt: row.changed_at?.toISOString() ?? null };
}

function lineDto(row: LineRow): OnlineOrderLineDto {
  return {
    id: row.id, variantId: row.variant_id, productId: row.product_id, productNameAr: row.product_name_ar,
    sizeNameAr: row.size_name_ar, colorNameAr: row.color_name_ar, requestedQuantity: row.requested_quantity,
    requestedListedUnitPricePiasters: integer(row.requested_listed_unit_price_piasters),
    requestedOriginalPiasters: integer(row.requested_original_piasters),
    requestedAutomaticOfferDiscountPiasters: integer(row.requested_automatic_offer_discount_piasters),
    requestedCouponDiscountPiasters: integer(row.requested_coupon_discount_piasters),
    requestedMerchandiseTotalPiasters: integer(row.requested_merchandise_total_piasters),
  };
}

function publicSubmission(row: SubmissionRow): PublicOrderSubmissionDto {
  return { orderId: row.id, reference: row.reference, status: "pending", submittedAt: row.submitted_at.toISOString(), quote: row.quote_json };
}
function area(row: AreaRow): DeliveryAreaDto {
  return { ...publicArea(row), active: row.active, changedByStaffId: row.changed_by_staff_id, changedAt: row.changed_at.toISOString() };
}
function publicArea(row: AreaRow): PublicDeliveryAreaDto {
  return { id: row.id, nameAr: row.name_ar, feePiasters: integer(row.fee_piasters) };
}
function areaValues(input: DeliveryAreaWrite) {
  return [input.id,input.nameAr,input.feePiasters,input.active,input.actorStaffId,input.changedAt];
}
function mapAreaError(error: unknown): never {
  if (pgCode(error) === "23505") throw new OnlineOrderValidationError("اسم منطقة التوصيل مستخدم بالفعل.");
  throw error;
}
function integer(value: number | string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed)) throw new Error("Unrepresentable online-order number.");
  return parsed;
}
function required<T extends QueryResultRow>(row: T | undefined): T {
  if (!row) throw new Error("Expected a PostgreSQL row.");
  return row;
}
function pgCode(error: unknown): string | undefined { return error && typeof error === "object" && "code" in error ? String(error.code) : undefined; }
function pgConstraint(error: unknown): string | undefined { return error && typeof error === "object" && "constraint" in error ? String(error.constraint) : undefined; }
function retryableTransactionError(error: unknown): boolean {
  const code = pgCode(error);
  return code === "40001" || code === "40P01";
}
