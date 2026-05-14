import dayjs from "dayjs";
import { computed, ref } from "vue";

export type RangeUnit = "day" | "week" | "month";

export function useHistoryRange() {
    const unit = ref<RangeUnit>("day");
    const anchor = ref(dayjs());

    const isToday = computed(() => anchor.value.isSame(dayjs(), "day"));

    const rangeStart = computed(() => {
        if (unit.value === "day") return anchor.value.startOf("day");
        if (unit.value === "week") return anchor.value.startOf("week");
        return anchor.value.startOf("month");
    });

    const rangeEnd = computed(() => {
        if (unit.value === "day")
            return anchor.value.add(1, "day").startOf("day");
        if (unit.value === "week")
            return anchor.value.endOf("week").add(1, "day").startOf("day");
        return anchor.value.add(1, "month").startOf("month");
    });

    const rangeLabel = computed(() => {
        if (unit.value === "day") return anchor.value.format("M月D日 ddd");
        if (unit.value === "week") {
            const s = anchor.value.startOf("week").format("M/D");
            const e = anchor.value.endOf("week").format("M/D");
            return `${s} – ${e} 周`;
        }
        return anchor.value.format("YYYY年M月");
    });

    function prev() {
        anchor.value = anchor.value.subtract(1, unit.value);
    }

    function next() {
        anchor.value = anchor.value.add(1, unit.value);
    }

    function goToday() {
        anchor.value = dayjs();
    }

    function setUnit(u: RangeUnit) {
        unit.value = u;
        anchor.value = dayjs();
    }

    return {
        unit,
        anchor,
        isToday,
        rangeStart,
        rangeEnd,
        rangeLabel,
        prev,
        next,
        goToday,
        setUnit,
    };
}
