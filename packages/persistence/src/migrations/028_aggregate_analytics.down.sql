DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public_analytics_event) THEN
    RAISE EXCEPTION 'Cannot remove aggregate analytics while retained public events exist';
  END IF;
END $$;

DROP INDEX online_order_delivered_analytics;
DROP TABLE public_analytics_event;
