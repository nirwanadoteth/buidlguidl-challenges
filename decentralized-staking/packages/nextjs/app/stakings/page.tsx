"use client";

import type { NextPage } from "next";
import { formatEther } from "viem";
import { Address } from "~~/components/scaffold-eth";
import { useScaffoldEventHistory } from "~~/hooks/scaffold-eth";

const Stakings: NextPage = () => {
  const { data: stakeEvents, isLoading } = useScaffoldEventHistory({
    contractName: "Staker",
    eventName: "Stake",
  });

  if (isLoading)
    return (
      <div className="flex justify-center items-center mt-10">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  return (
    <div className="flex items-center flex-col flex-grow pt-10">
      <div className="px-5">
        <h1 className="text-center mb-3">
          <span className="block text-2xl font-bold">All Staking Events</span>
        </h1>
      </div>
      <div className="overflow-x-auto shadow-lg">
        <table className="table table-zebra w-full">
          <thead>
            <tr>
              <th className="bg-primary">From</th>
              <th className="bg-primary">Value</th>
            </tr>
          </thead>
          <tbody>
            {!stakeEvents || stakeEvents.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center">
                  No events found
                </td>
              </tr>
            ) : (
              stakeEvents?.map((event, index) => {
                // Support both named and positional args from viem logs
                const sender = (event as any)?.args?.sender ?? (event as any)?.args?.[0];
                const amount = (event as any)?.args?.amount ?? (event as any)?.args?.[1] ?? 0n;
                return (
                  <tr key={index}>
                    <td>
                      <Address address={sender} />
                    </td>
                    <td>{formatEther(amount)} ETH</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Stakings;
