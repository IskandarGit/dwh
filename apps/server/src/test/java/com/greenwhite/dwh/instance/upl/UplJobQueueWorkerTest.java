package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.instance.fnd.jobs.FndJobRunner;
import com.greenwhite.dwh.instance.upl.worker.UplJobQueueWorker;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;

/** Запускатель очереди: порядок вызовов и живучесть при сбое задания. */
class UplJobQueueWorkerTest {

    @Test
    @DisplayName("такт сначала ставит задания расписания, затем выполняет очередь")
    void tickEnqueuesThenRuns() {
        FndJobRunner runner = mock(FndJobRunner.class);

        new UplJobQueueWorker(runner).tick();

        InOrder order = inOrder(runner);
        order.verify(runner).enqueueDue();
        order.verify(runner).runQueued();
        order.verifyNoMoreInteractions();
    }

    @Test
    @DisplayName("сбой внутри такта не выпускает исключение наружу")
    void tickSwallowsFailure() {
        FndJobRunner runner = mock(FndJobRunner.class);
        doThrow(new IllegalStateException("TEST сбой очереди")).when(runner).enqueueDue();

        assertThatCode(() -> new UplJobQueueWorker(runner).tick()).doesNotThrowAnyException();
    }
}
