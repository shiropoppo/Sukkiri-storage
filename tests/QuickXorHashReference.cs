// Microsoft 公開の QuickXorHash 実装（https://learn.microsoft.com/onedrive/developer/code-snippets/quickxorhash）
// tests/hash-check.ps1 から読み込み、JavaScript 版と結果が一致するかの検証だけに使う。
using System;

public class QuickXorHashReference : System.Security.Cryptography.HashAlgorithm
{
    private const int BitsInLastCell = 32;
    private const byte Shift = 11;
    private const byte WidthInBits = 160;

    private UInt64[] _data;
    private Int64 _lengthSoFar;
    private int _shiftSoFar;

    public QuickXorHashReference() { this.Initialize(); }

    protected override void HashCore(byte[] array, int ibStart, int cbSize)
    {
        unchecked
        {
            int currentShift = this._shiftSoFar;
            int vectorArrayIndex = currentShift / 64;
            int vectorOffset = currentShift % 64;
            int iterations = Math.Min(cbSize, WidthInBits);

            for (int i = 0; i < iterations; i++)
            {
                bool isLastCell = vectorArrayIndex == this._data.Length - 1;
                int bitsInVectorCell = isLastCell ? BitsInLastCell : 64;

                if (vectorOffset <= bitsInVectorCell - 8)
                {
                    for (int j = ibStart + i; j < cbSize + ibStart; j += WidthInBits)
                    {
                        this._data[vectorArrayIndex] ^= (ulong)array[j] << vectorOffset;
                    }
                }
                else
                {
                    int index1 = vectorArrayIndex;
                    int index2 = isLastCell ? 0 : (vectorArrayIndex + 1);
                    byte low = (byte)(bitsInVectorCell - vectorOffset);

                    byte xoredByte = 0;
                    for (int j = ibStart + i; j < cbSize + ibStart; j += WidthInBits)
                    {
                        xoredByte ^= array[j];
                    }
                    this._data[index1] ^= (ulong)xoredByte << vectorOffset;
                    this._data[index2] ^= (ulong)xoredByte >> low;
                }
                vectorOffset += Shift;
                while (vectorOffset >= bitsInVectorCell)
                {
                    vectorArrayIndex = isLastCell ? 0 : vectorArrayIndex + 1;
                    vectorOffset -= bitsInVectorCell;
                }
            }
            this._shiftSoFar = (this._shiftSoFar + Shift * (cbSize % WidthInBits)) % WidthInBits;
        }
        this._lengthSoFar += cbSize;
    }

    protected override byte[] HashFinal()
    {
        byte[] rgb = new byte[(WidthInBits - 1) / 8 + 1];
        for (Int32 i = 0; i < this._data.Length - 1; i++)
        {
            Buffer.BlockCopy(BitConverter.GetBytes(this._data[i]), 0, rgb, i * 8, 8);
        }
        Buffer.BlockCopy(BitConverter.GetBytes(this._data[this._data.Length - 1]), 0,
            rgb, (this._data.Length - 1) * 8, rgb.Length - (this._data.Length - 1) * 8);

        var lengthBytes = BitConverter.GetBytes(this._lengthSoFar);
        for (int i = 0; i < lengthBytes.Length; i++)
        {
            rgb[(WidthInBits / 8) - lengthBytes.Length + i] ^= lengthBytes[i];
        }
        return rgb;
    }

    public override sealed void Initialize()
    {
        this._data = new ulong[(WidthInBits - 1) / 64 + 1];
        this._shiftSoFar = 0;
        this._lengthSoFar = 0;
    }

    public override int HashSize { get { return WidthInBits; } }
}
